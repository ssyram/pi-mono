import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AdvisoryQueue } from "../src/watch/advisory-queue.ts";
import { drainOnce } from "../src/watch/drain-advisories.ts";
import { createWaitState, registerAskTool } from "../src/watch/ask-tool.ts";
import type { DaemonReply, DaemonRequester } from "../src/broker/daemon-request.ts";

function piStub(messages: unknown[] = []) {
	const tools = new Map<string, { execute: (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: ExtensionContext) => Promise<unknown> }>();
	const pi = {
		registerTool: (definition: { name: string } & Record<string, unknown>) => {
			tools.set(definition.name, definition as never);
		},
		sendMessage: (message: unknown, options?: unknown) => { messages.push({ message, options }); },
	} as unknown as ExtensionAPI;
	return { pi, tools, messages };
}

function askCtx(ui: Partial<ExtensionContext["ui"]>): ExtensionContext {
	return { ui } as unknown as ExtensionContext;
}

function requester(posts: string[]): DaemonRequester {
	return async (input): Promise<DaemonReply> => {
		posts.push(input.path);
		if (input.path === "/check-permission") return { status: 200, body: { ok: true, allowed: true } };
		return { status: 200, body: { ok: true } };
	};
}

test("ask tool waits on a real dialog, tracks wait state and releases the gate ask-end", async () => {
	const posts: string[] = [];
	const { pi, tools } = piStub();
	const waitState = createWaitState();
	registerAskTool(pi, { request: requester(posts), binding: () => ({ sessionId: "r", agentId: "main" }), waitState, timeoutMs: 5000 });
	const ask = tools.get("question")!;
	let releaseSelect: ((value: string) => void) | undefined;
	const ctx = askCtx({ select: () => new Promise((resolve) => { releaseSelect = resolve; }), input: () => Promise.resolve("") });
	const pending = ask.execute("call-1", { questions: [{ question: "continue?", options: [{ label: "yes" }, { label: "no" }] }] }, undefined, undefined, ctx);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(waitState, { active: true, since: waitState.since, question: "continue?" });
	assert.ok(waitState.since > 0);
	releaseSelect!("yes");
	const result = (await pending) as { content: { text: string }[] };
	assert.equal(result.content[0]?.text, `User has answered your questions: "continue?"="yes". You can now continue with the user's answers in mind.`);
	assert.equal(waitState.active, false);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(posts, ["/gate/release"]);
	const noUi = (await tools.get("question")!.execute("call-2", { questions: [{ question: "q" }] }, undefined, undefined, askCtx({} as never))) as { isError: boolean };
	assert.equal(noUi.isError, true);
	const cancelled = askCtx({ select: () => Promise.reject(new Error("user escaped")), input: () => Promise.resolve("") });
	const failed = (await ask.execute("call-3", { questions: [{ question: "q", options: [{ label: "a" }] }] }, undefined, undefined, cancelled)) as { isError: boolean };
	assert.equal(failed.isError, true);
	assert.equal(waitState.active, false);
});

test("drainOnce schedules only for idle targets and consumes only on real branch evidence", () => {
	const messages: unknown[] = [];
	const { pi } = piStub(messages);
	const queue = new AdvisoryQueue(8);
	const first = queue.accept("child-1", { parts: [{ type: "text", text: "wake up" }] });
	const second = queue.accept("child-2", { parts: [{ type: "text", text: "later" }] });
	assert.ok(first && second);
	const consumedIds = new Set<string>();
	drainOnce(pi, queue, { isIdle: (sid) => sid === "child-1", consumed: (id) => consumedIds.has(id) });
	assert.equal(first.state, "scheduled");
	assert.equal(second.state, "accepted");
	assert.equal(messages.length, 1);
	assert.deepEqual((messages[0] as { message: { customType: string; details: { deliveryId: string } } }).message.details.deliveryId, first.deliveryId);
	consumedIds.add(first.deliveryId);
	queue.accept("child-1", { parts: [{ type: "text", text: "again" }] });
	drainOnce(pi, queue, { isIdle: (sid) => sid === "child-1", consumed: (id) => consumedIds.has(id) });
	assert.equal(queue.snapshot().find((item) => item.deliveryId === first.deliveryId), undefined, "consumed entries evict");
	const third = queue.snapshot().find((item) => item.text === "again");
	assert.equal(third?.state, "scheduled");
});

test("drainOnce marks failed when sendMessage rejects", () => {
	const pi = { sendMessage: () => { throw new Error("owner gone"); } } as unknown as ExtensionAPI;
	const queue = new AdvisoryQueue(4);
	const item = queue.accept("child-1", { parts: [{ type: "text", text: "x" }] });
	drainOnce(pi, queue, { isIdle: () => true, consumed: () => false });
	assert.equal(item.state, "failed");
	assert.equal(queue.snapshot().length, 0, "failed entries evict for observability via markFailed");
});
