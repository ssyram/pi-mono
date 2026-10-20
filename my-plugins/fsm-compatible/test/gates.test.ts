import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DaemonReply, DaemonRequest, DaemonRequester } from "../src/broker/daemon-request.ts";
import { installPermissionGate } from "../src/gates/permission-gate.ts";
import { installStopGate, runStopCheck } from "../src/gates/stop-gate.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function fakePi() {
	const handlers = new Map<string, Handler>();
	const pi = { on(event: string, handler: Handler) { handlers.set(event, handler); return () => handlers.delete(event); } } as unknown as ExtensionAPI;
	return { pi, handlers };
}

function fakeCtx(): ExtensionContext {
	return { signal: undefined, ui: { notify: () => {} } } as unknown as ExtensionContext;
}

function requester(script: Record<string, unknown | Error>): { request: DaemonRequester; seen: string[]; bodies: unknown[] } {
	const seen: string[] = [];
	const bodies: unknown[] = [];
	const request: DaemonRequester = async (input): Promise<DaemonReply> => {
		seen.push(`${input.method} ${input.path}`);
		if (input.path === "/check-permission") bodies.push(input.body);
		const reply = script[`${input.method} ${input.path}`];
		if (reply instanceof Error) throw reply;
		return reply as DaemonReply;
	};
	return { request, seen, bodies };
}

const ok = (body: unknown): DaemonReply => ({ status: 200, body: { ok: true, ...(body as object) } });

test("permission gate maps allow/deny verbatim, fails closed, checks exactly once per call", async () => {
	const { pi, handlers } = fakePi();
	const { request, seen, bodies } = requester({ "POST /check-permission": ok({ allowed: true }) });
	let binding = { sessionId: "r", agentId: "main" };
	const off = installPermissionGate(pi, request, () => binding, 5000);
	const gate = handlers.get("tool_call")!;
	assert.deepEqual(await gate({ toolName: "read", input: { path: "/a" } }, fakeCtx()), undefined);
	assert.deepEqual(bodies, [{ session_id: "r", agent_id: "main", tool_name: "Read", tool_input: { file_path: "/a" } }]);
	const deniedRequest = requester({ "POST /check-permission": ok({ allowed: false, reason: "state blocks read" }) }).request;
	const { handlers: h2 } = fakePi();
	installPermissionGate(piAs(h2), deniedRequest, () => binding, 5000);
	const deniedGate = h2.get("tool_call")!;
	assert.deepEqual(await deniedGate({ toolName: "read", input: { path: "/a" } }, fakeCtx()),
		{ block: true, reason: "state blocks read" });
	const broken = requester({ "POST /check-permission": new Error("down") }).request;
	const { handlers: h3 } = fakePi();
	installPermissionGate(piAs(h3), broken, () => binding, 5000);
	const brokenGate = h3.get("tool_call")!;
	const result = await brokenGate({ toolName: "bash", input: { command: "ls" } }, fakeCtx());
	assert.deepEqual(result, { block: true, reason: "FSM 门禁：check-permission 不可达，按 fail-close 拒绝。" });
	const fsmRequest = requester({}).request;
	const { handlers: h4 } = fakePi();
	installPermissionGate(piAs(h4), fsmRequest, () => binding, 5000);
	assert.equal(await h4.get("tool_call")!({ toolName: "mcp__fsm__fsm_get_state", input: {} }, fakeCtx()), undefined);
	const checks = seen.filter((entry) => entry === "POST /check-permission");
	assert.equal(checks.length, 1);
	assert.equal(seen.length - checks.length, 1, "exactly one best-effort gate move from the allowed verdict");
	binding = undefined as never;
	const notReady = await handlers.get("tool_call")!({ toolName: "read", input: {} }, fakeCtx());
	assert.deepEqual(notReady, { block: true, reason: "fsm-compatible runtime not ready" });
	off();
});

function piAs(handlers: Map<string, Handler>): ExtensionAPI {
	return { on(event: string, handler: Handler) { handlers.set(event, handler); return () => handlers.delete(event); } } as unknown as ExtensionAPI;
}

test("stop gate blocks with a continuation draft and soft-gates transport failures", async () => {
	const { pi, handlers } = fakePi();
	const { request } = requester({ "POST /stop-check": ok({ is_terminal: false, reason: "review pending" }) });
	installStopGate(pi, request, () => ({ sessionId: "r", agentId: "main" }), 5000);
	const gate = handlers.get("agent_before_settle")!;
	const completed = { outcome: "completed", continue: false,
		context: { contextMessages: [{ role: "assistant", content: [{ type: "text", text: "turn output" }] }] } };
	assert.deepEqual(await gate(completed, fakeCtx()), { entries: [{ type: "custom_message",
		customType: "fsm-compatible:stop", content: "review pending", display: true }], continue: true });
	const { request: allowed } = requester({ "POST /stop-check": { status: 200, body: { is_terminal: true } } });
	const { handlers: h2 } = fakePi();
	installStopGate(piAs(h2), allowed, () => ({ sessionId: "r", agentId: "main" }), 5000);
	assert.equal(await h2.get("agent_before_settle")!(completed, fakeCtx()), undefined);
	const { request: down } = requester({ "POST /stop-check": new Error("down") });
	const { handlers: h3 } = fakePi();
	installStopGate(piAs(h3), down, () => ({ sessionId: "r", agentId: "main" }), 5000);
	assert.equal(await h3.get("agent_before_settle")!(completed, fakeCtx()), undefined);
	assert.equal(await handlers.get("agent_before_settle")!({ outcome: "aborted", continue: false, context: { contextMessages: [] } }, fakeCtx()), undefined);
	assert.equal(await handlers.get("agent_before_settle")!({ outcome: "completed", continue: true, context: { contextMessages: [] } }, fakeCtx()), undefined);
});

test("repeated same-name permission checks use explicit root/child IDs without writing identity slots", async () => {
	for (const agentId of ["main", "child-1"]) {
		for (const allowed of [true, false]) {
			const seen: DaemonRequest[] = [];
			const request: DaemonRequester = async (input) => {
				seen.push(input);
				return input.path === "/check-permission"
					? { status: 200, body: { allowed, reason: "state denies write" } }
					: { status: 200, body: { ok: true } };
			};
			const { pi, handlers } = fakePi();
			installPermissionGate(pi, request, () => ({ sessionId: "r", agentId }), 5000);
			for (let index = 0; index < 3; index++) {
				assert.deepEqual(await handlers.get("tool_call")!({ toolName: "write", input: { path: "/a", content: "x" } }, fakeCtx()),
					allowed ? undefined : { block: true, reason: "state denies write" });
			}
			const checks = seen.filter((input) => input.path === "/check-permission");
			assert.equal(checks.length, 3);
			for (const input of checks) {
				assert.equal(input.identity, undefined);
				assert.deepEqual(input.body, { session_id: "r", agent_id: agentId, tool_name: "Write", tool_input: { file_path: "/a", content: "x" } });
			}
			assert.equal(seen.some((input) => input.path === "/identity/acquire"), false);
		}
	}
});

test("repeated stop checks preserve actor and verdict without writing identity slots", async () => {
	for (const agentId of ["main", "child-1"]) {
		for (const isTerminal of [true, false]) {
			const seen: DaemonRequest[] = [];
			const request: DaemonRequester = async (input) => {
				seen.push(input);
				return { status: 200, body: { is_terminal: isTerminal, reason: "state verdict" } };
			};
			for (let index = 0; index < 3; index++) {
				assert.deepEqual(await runStopCheck(request, { sessionId: "r", agentId }, [], Date.now() + 5000),
					{ allowed: isTerminal, reason: "state verdict" });
			}
			assert.equal(seen.length, 3);
			for (const input of seen) {
				assert.equal(input.path, "/stop-check");
				assert.equal(input.identity, undefined);
				assert.deepEqual(input.body, { session_id: "r", agent_id: agentId });
			}
		}
	}
});
