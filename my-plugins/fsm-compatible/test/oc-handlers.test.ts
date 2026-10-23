import { protocolSessionId } from "../src/binding/create-root-binding.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerFauxProvider, streamSimple, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { OcServer } from "../src/protocol/oc-server.ts";
import { createOcHandlers } from "../src/protocol/oc-handlers.ts";
import { JudgeSessions } from "../src/judge/judge-session.ts";
import { RecordStore } from "../src/records/record-store.ts";
import { AdvisoryQueue } from "../src/watch/advisory-queue.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";

function rootBinding(sessionId: string) {
	return { version: 1 as const, rootSessionId: protocolSessionId(sessionId), sessionId, parentSessionId: null, agentId: "main",
		kind: "execution-root" as const, agentName: null, bootstrapRef: null, requiredExtensions: [] };
}

test("handlers serve the real store and judges over HTTP with target separation", async (t) => {
	const faux = registerFauxProvider({ models: [{ id: "faux-1" }] });
	faux.setResponses([fauxAssistantMessage("cut short", { stopReason: "length" })]);
	const cwd = await mkdtemp(join(tmpdir(), "fsm-handlers-"));
	t.after(async () => { await rm(cwd, { recursive: true, force: true }); });
	const manager = SessionManager.inMemory(cwd, { id: "root-h" });
	manager.appendMessage({ role: "user", content: "work", timestamp: Date.now() });
	const store = new RecordStore(rootBinding("root-h"));
	store.publishExecution(rootBinding("root-h"), { title: "root", lifecycle: "running", updatedAt: Date.now(),
		header: manager.getHeader(), branch: manager.getBranch(), sessionFile: null, errorMessage: null });
	const judges = new JudgeSessions(store, cwd, { model: faux.getModel(), getApiKey: () => "faux-key", streamFn: streamSimple });
	const server = new OcServer(createOcHandlers(store, judges));
	server.setPassword("pw");
	const base = await server.listen();
	t.after(() => server.close());
	const auth = { authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}` };
	const roster = await (await fetch(`${base}/session`, { headers: auth })).json();
	assert.equal(roster[0].id, protocolSessionId("root-h"));
	const created = await (await fetch(`${base}/session`, { method: "POST", headers: auth, body: JSON.stringify({ title: "fsm-gate" }) })).json();
	assert.ok(created.id);
	const posted = await fetch(`${base}/session/${created.id}/message`, { method: "POST", headers: auth,
		body: JSON.stringify({ system: "s", tools: { "*": false, StructuredOutput: true },
			format: { type: "json_schema", schema: { type: "object" } }, parts: [{ type: "text", text: "go" }] }) });
	assert.equal(posted.status, 200);
	const envelope = await posted.json();
	assert.equal(envelope.info.error?.name, "MessageOutputLengthError");
	const executionPost = await fetch(`${base}/session/root-h/message`, { method: "POST", headers: auth, body: "{}" });
	assert.equal(executionPost.status, 403);
	const judgeGet = await fetch(`${base}/session/${created.id}/message`, { headers: auth });
	assert.equal(judgeGet.status, 403);
	const wrongCreate = await fetch(`${base}/session`, { method: "POST", headers: auth, body: JSON.stringify({ title: "other" }) });
	assert.equal(wrongCreate.status, 400);
	const badShape = await fetch(`${base}/session/${created.id}/message`, { method: "POST", headers: auth, body: JSON.stringify({ system: "s" }) });
	assert.equal(badShape.status, 400);
	const judgeChildren = await fetch(`${base}/session/${created.id}/children`, { headers: auth });
	assert.deepEqual(await judgeChildren.json(), []);
	const promptAsync = await fetch(`${base}/session/root-h/prompt_async`, { method: "POST", headers: auth,
		body: JSON.stringify({ parts: [{ type: "text", text: "notify" }] }) });
	assert.equal(promptAsync.status, 503);
	const unknownAsync = await fetch(`${base}/session/ghost/prompt_async`, { method: "POST", headers: auth,
		body: JSON.stringify({ parts: [{ type: "text", text: "x" }] }) });
	assert.equal(unknownAsync.status, 404);
});

test("prompt_async with a wired queue returns strict 204 and enforces tree targets and capacity", async (t) => {
	const faux = registerFauxProvider({ models: [{ id: "faux-1" }] });
	const cwd = await mkdtemp(join(tmpdir(), "fsm-handlers-q-"));
	t.after(async () => { await rm(cwd, { recursive: true, force: true }); });
	const manager = SessionManager.inMemory(cwd, { id: "root-q" });
	const store = new RecordStore(rootBinding("root-q"));
	store.publishExecution(rootBinding("root-q"), { title: "root", lifecycle: "idle", updatedAt: Date.now(),
		header: manager.getHeader(), branch: manager.getBranch(), sessionFile: null, errorMessage: null });
	const judges = new JudgeSessions(store, cwd, { model: faux.getModel(), getApiKey: () => "faux-key", streamFn: streamSimple });
	const advisories = new AdvisoryQueue(1);
	const server = new OcServer(createOcHandlers(store, judges, { advisories }));
	server.setPassword("pw");
	const base = await server.listen();
	t.after(() => server.close());
	const auth = { authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}` };
	const ok204 = await fetch(`${base}/session/root-q/prompt_async`, { method: "POST", headers: auth,
		body: JSON.stringify({ parts: [{ type: "text", text: "wake" }] }) });
	assert.equal(ok204.status, 204);
	assert.equal(await ok204.text(), "");
	assert.equal(advisories.snapshot().length, 1);
	const full = await fetch(`${base}/session/root-q/prompt_async`, { method: "POST", headers: auth,
		body: JSON.stringify({ parts: [{ type: "text", text: "spill" }] }) });
	assert.equal(full.status, 503);
	const badShape = await fetch(`${base}/session/root-q/prompt_async`, { method: "POST", headers: auth,
		body: JSON.stringify({ parts: [{ type: "image" }] }) });
	assert.equal(badShape.status, 400);
	const unknownTarget = await fetch(`${base}/session/ghost/prompt_async`, { method: "POST", headers: auth,
		body: JSON.stringify({ parts: [{ type: "text", text: "x" }] }) });
	assert.equal(unknownTarget.status, 404);
});
