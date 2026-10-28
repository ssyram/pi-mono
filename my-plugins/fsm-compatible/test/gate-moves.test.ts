import assert from "node:assert/strict";
import test from "node:test";
import { AdvisoryQueue } from "../src/watch/advisory-queue.ts";
import { gateShouldSuppress, moveGate } from "../src/gates/gate-moves.ts";
import type { DaemonReply, DaemonRequester } from "../src/broker/daemon-request.ts";
import { installPermissionGate } from "../src/gates/permission-gate.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function fakePi() {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const pi = { on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
		handlers.set(event, handler);
		return () => handlers.delete(event);
	} } as unknown as ExtensionAPI;
	return { pi, handlers };
}

function ctx(): ExtensionContext {
	return { signal: undefined, ui: { notify: () => {} } } as unknown as ExtensionContext;
}

test("gate bisection: only an allowed AskUserQuestion suppresses; everything else releases", () => {
	assert.equal(gateShouldSuppress(true, "question"), true);
	assert.equal(gateShouldSuppress(false, "question"), false);
	assert.equal(gateShouldSuppress(true, "bash"), false);
	assert.equal(gateShouldSuppress(false, "read"), false);
});

test("permission verdicts ride the main gate best-effort; children and failures never move it", async () => {
	const { pi, handlers } = fakePi();
	const posts: Array<{ path: string; body: unknown }> = [];
	const request: DaemonRequester = async (input): Promise<DaemonReply> => {
		if (input.path === "/gate/suppress" || input.path === "/gate/release") {
			posts.push({ path: input.path, body: input.body });
			return { status: 200, body: { ok: true } };
		}
		if (input.path === "/check-permission") return { status: 200, body: { ok: true, allowed: true } };
		if (input.path === "/check-permission-denied") return { status: 200, body: { ok: true, allowed: false } };
		throw new Error("unexpected route");
	};
	installPermissionGate(pi, request, () => ({ sessionId: "r", agentId: "main" }), 5000);
	const gate = handlers.get("tool_call")!;
	assert.equal(await gate({ toolName: "question", input: { question: "q" } }, ctx()), undefined);
	assert.equal(await gate({ toolName: "bash", input: { command: "ls" } }, ctx()), undefined);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(posts, [
		{ path: "/gate/suppress", body: { session_id: "r", agent_id: "main", reason: "ask-start" } },
		{ path: "/gate/release", body: { session_id: "r", agent_id: "main", reason: "main-tool-start" } },
	]);
	const failing: DaemonRequester = async (input): Promise<DaemonReply> => {
		if (input.path === "/gate/suppress") throw new Error("gate down");
		if (input.path === "/gate/release") throw new Error("gate down");
		return { status: 200, body: { ok: true, allowed: true } };
	};
	const { pi: p2, handlers: h2 } = fakePi();
	installPermissionGate(p2, failing, () => ({ sessionId: "r", agentId: "main" }), 5000);
	assert.equal(await h2.get("tool_call")!({ toolName: "question", input: {} }, ctx()), undefined);
	const childRequest: DaemonRequester = async (input): Promise<DaemonReply> => {
		if (input.path.startsWith("/gate/")) throw new Error("child must not move the main gate");
		return { status: 200, body: { ok: true, allowed: true } };
	};
	const { pi: p3, handlers: h3 } = fakePi();
	installPermissionGate(p3, childRequest, () => ({ sessionId: "c", agentId: "child-1" }), 5000);
	assert.equal(await h3.get("tool_call")!({ toolName: "question", input: {} }, ctx()), undefined);
	assert.equal(await handlers.get("tool_call")!({ toolName: "mcp__fsm__fsm_get_state", input: {} }, ctx()), undefined);
});

test("moveGate maps main-only and swallows transport failures", async () => {
	const posts: string[] = [];
	const request: DaemonRequester = async (input): Promise<DaemonReply> => {
		posts.push(input.path);
		return { status: 200, body: { ok: true } };
	};
	await moveGate(request, { sessionId: "r", agentId: "main" }, true, "ask-start", Date.now() + 1000);
	await moveGate(request, { sessionId: "c", agentId: "child" }, true, "ask-start", Date.now() + 1000);
	const broken: DaemonRequester = async () => { throw new Error("down"); };
	await moveGate(broken, { sessionId: "r", agentId: "main" }, false, "ask-end", Date.now() + 1000);
	assert.deepEqual(posts, ["/gate/suppress"]);
});

test("advisory queue keeps 204 semantics: accept, deliver lifecycle, bounds and owner close", () => {
	const queue = new AdvisoryQueue(2);
	const first = queue.accept("r", { parts: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] });
	assert.equal(first.text, "hello\nworld");
	assert.equal(first.state, "accepted");
	queue.markScheduled(first.deliveryId);
	assert.throws(() => queue.markScheduled(first.deliveryId), { code: "not-ready" });
	queue.markConsumed(first.deliveryId);
	assert.equal(queue.snapshot().length, 0);
	const second = queue.accept("r", { parts: [{ type: "text", text: "x" }] });
	const third = queue.accept("r", { parts: [{ type: "text", text: "y" }] });
	assert.ok(second && third);
	assert.throws(() => queue.accept("r", { parts: [{ type: "text", text: "z" }] }), { code: "queue-full" });
	assert.throws(() => queue.accept("r", { parts: [{ type: "image" }] }), { code: "protocol-invalid" });
	queue.markFailed(second.deliveryId);
	const fourth = queue.accept("r", { parts: [{ type: "text", text: "w" }] });
	assert.ok(fourth);
	queue.close();
	assert.deepEqual(queue.snapshot().map((item) => item.state), ["failed", "failed"]);
	assert.throws(() => queue.accept("r", { parts: [{ type: "text", text: "late" }] }), { code: "owner-unavailable" });
});
