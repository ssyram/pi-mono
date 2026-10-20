import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerFauxProvider, streamSimple, fauxToolCall, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { parseJudgeInput } from "../src/judge/judge-input.ts";
import { JudgeSessions } from "../src/judge/judge-session.ts";
import { RecordStore } from "../src/records/record-store.ts";

function rootBinding(sessionId: string) {
	return { version: 1 as const, rootSessionId: sessionId, sessionId, parentSessionId: null, agentId: "main",
		kind: "execution-root" as const, agentName: null, bootstrapRef: null, requiredExtensions: [] };
}

function input(overrides: { parts?: unknown[] } = {}) {
	return parseJudgeInput({
		system: "judge",
		tools: { "*": false, StructuredOutput: true },
		format: { type: "json_schema", schema: { type: "object", properties: { verdict: { type: "string" } },
			required: ["verdict"], additionalProperties: false } },
		parts: overrides.parts ?? [{ type: "text", text: "decide" }],
	});
}

async function harness(maxJudges?: number) {
	const faux = registerFauxProvider({ models: [{ id: "faux-1" }] });
	faux.setResponses([]);
	const cwd = await mkdtemp(join(tmpdir(), "fsm-judge-session-"));
	const manager = SessionManager.inMemory(cwd, { id: "root-9" });
	const store = new RecordStore(rootBinding("root-9"));
	store.publishExecution(rootBinding("root-9"), { title: "root", lifecycle: "idle", updatedAt: Date.now(),
		header: manager.getHeader(), branch: manager.getBranch(), sessionFile: null, errorMessage: null });
	const sessions = new JudgeSessions(store, cwd, { model: faux.getModel(), getApiKey: () => "faux-key", streamFn: streamSimple }, maxJudges);
	return { faux, store, sessions, cleanup: () => { sessions.close(); return rm(cwd, { recursive: true, force: true }); } };
}

test("a captured structured output turn ends with a complete terminal envelope", async (t) => {
	const context = await harness();
	t.after(context.cleanup);
	context.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("StructuredOutput", { verdict: "allow" }, { id: "so-1" })], { stopReason: "toolUse" }),
	]);
	const sid = context.sessions.create();
	const envelope = await context.sessions.run(sid, input());
	assert.equal(envelope.info.role, "assistant");
	const part = envelope.parts.find((item) => item.type === "tool" && item.tool === "StructuredOutput");
	assert.ok(part && part.type === "tool");
	assert.equal(part.state.status, "completed");
	assert.deepEqual(part.state.input, { verdict: "allow" });
	assert.equal(part.callID, "so-1");
	assert.equal(part.sessionID, sid);
	assert.equal(envelope.info.finish, "tool-calls");
	assert.ok(envelope.info.time.completed !== undefined);
	assert.equal(context.store.getJudge(sid)?.lifecycle, "idle");
});

test("invalid attempts stay error parts and a later valid capture still completes the turn", async (t) => {
	const context = await harness();
	t.after(context.cleanup);
	context.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("StructuredOutput", { verdict: 42 }, { id: "bad" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("StructuredOutput", { verdict: "block" }, { id: "good" })], { stopReason: "toolUse" }),
	]);
	const sid = context.sessions.create();
	const envelope = await context.sessions.run(sid, input());
	const parts = envelope.parts.filter((item) => item.type === "tool" && item.tool === "StructuredOutput");
	assert.deepEqual(parts.map((part) => part.type === "tool" ? part.state.status : ""), ["error", "completed"]);
	assert.equal(parts[0]?.type === "tool" ? parts[0].callID : undefined, "bad");
	assert.ok(parts[0]?.type === "tool" ? parts[0].state.error !== undefined : false);
});

test("two different valid captures are both preserved as real conflict material", async (t) => {
	const context = await harness();
	t.after(context.cleanup);
	context.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("StructuredOutput", { verdict: "allow" }, { id: "a" }),
			fauxToolCall("StructuredOutput", { verdict: "block" }, { id: "b" })], { stopReason: "toolUse" }),
	]);
	const sid = context.sessions.create();
	const envelope = await context.sessions.run(sid, input());
	const captures = envelope.parts.filter((item) => item.type === "tool" && item.tool === "StructuredOutput");
	assert.equal(captures.length, 2);
});

test("length errors surface as terminal errors and abort is confirmed only after idle", async (t) => {
	const context = await harness();
	t.after(context.cleanup);
	context.faux.setResponses([
		fauxAssistantMessage("partial answer", { stopReason: "length" }),
	]);
	const sid = context.sessions.create();
	const idleSid = context.sessions.create();
	const envelope = await context.sessions.run(sid, input());
	assert.equal(envelope.info.error?.name, "MessageOutputLengthError");
	assert.equal(await context.sessions.abort(idleSid), true);
	await assert.rejects(context.sessions.abort("missing-session"), { code: "not-ready" });
	await assert.rejects(context.sessions.run("missing-session", input()), { code: "not-ready" });
});

test("web tool requests stay explicit not-ready until factories are installed", async (t) => {
	const context = await harness();
	t.after(context.cleanup);
	const sid = context.sessions.create();
	const web = parseJudgeInput({ system: "s", tools: { "*": false, StructuredOutput: true, webfetch: true },
		format: { type: "json_schema", schema: { type: "object" } }, parts: [{ type: "text", text: "go" }] });
	await assert.rejects(context.sessions.run(sid, web), { code: "not-ready" });
});

test("abort during a live turn waits for real termination before reporting idle", async (t) => {
	const context = await harness();
	t.after(context.cleanup);
	let release: ((message: import("@earendil-works/pi-ai").AssistantMessage) => void) | undefined;
	context.faux.setResponses([() => new Promise<import("@earendil-works/pi-ai").AssistantMessage>((resolve) => { release = resolve; })]);
	const sid = context.sessions.create();
	const pending = context.sessions.run(sid, input());
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(context.store.getJudge(sid)?.lifecycle, "busy");
	const aborting = context.sessions.abort(sid);
	await new Promise((resolve) => setTimeout(resolve, 30));
	release?.(fauxAssistantMessage("late", { stopReason: "aborted" }));
	assert.equal(await aborting, true);
	await pending.then(() => undefined, () => undefined);
	assert.equal(context.store.getJudge(sid)?.lifecycle, "idle");
});

test("judge capacity is bounded", async (t) => {
	const context = await harness(1);
	t.after(context.cleanup);
	assert.ok(context.sessions.create());
	assert.throws(() => context.sessions.create(), { code: "queue-full" });
});

test("same-sid repair continues in one transcript without reusing stale captures", async (t) => {
	const context = await harness();
	t.after(context.cleanup);
	const sid = context.sessions.create();
	context.faux.setResponses([fauxAssistantMessage([fauxToolCall("StructuredOutput", { verdict: "allow" }, { id: "first" })], { stopReason: "toolUse" })]);
	const first = await context.sessions.run(sid, input());
	assert.ok(first.parts.some((part) => part.type === "tool" && part.callID === "first"));
	context.faux.setResponses([fauxAssistantMessage([fauxToolCall("StructuredOutput", { verdict: "block" }, { id: "second" })], { stopReason: "toolUse" })]);
	const second = await context.sessions.run(sid, input());
	assert.ok(second.parts.some((part) => part.type === "tool" && part.callID === "second"));
	assert.ok(!second.parts.some((part) => part.type === "tool" && part.callID === "first"), "stale capture must not leak into the repair turn");
	assert.equal(second.parts.filter((part) => part.type === "tool" && part.tool === "StructuredOutput").length, 1);
	await assert.rejects(Promise.all([context.sessions.run(sid, input()), context.sessions.run(sid, input())].map((promise) => promise.catch((error) => { throw error; }))), { code: "queue-full" });
});
