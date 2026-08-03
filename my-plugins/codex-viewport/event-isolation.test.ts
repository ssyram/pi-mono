import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import codexViewport from "./codex-viewport.js";
import { createTestTuiContext } from "./test-tui-context.js";

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;

function registerHandlers(): Map<string, Handler> {
	const handlers = new Map<string, Handler>();
	const api = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
	} as unknown as ExtensionAPI;
	codexViewport(api);
	return handlers;
}

function invoke(
	handlers: Map<string, Handler>,
	name: string,
	event: Record<string, unknown>,
	ctx: ExtensionContext,
): unknown {
	const handler = handlers.get(name);
	assert.ok(handler);
	return handler(event, ctx);
}

describe("extension event isolation", () => {
	it("does not mutate messages, tool events, signals, or abort state", () => {
		const test = createTestTuiContext();
		const handlers = registerHandlers();
		invoke(handlers, "session_start", { type: "session_start", reason: "startup" }, test.ctx);
		invoke(handlers, "agent_start", { type: "agent_start" }, test.ctx);
		const controller = new AbortController();
		const events = [
			{ type: "message_start", message: { role: "assistant", content: [] }, signal: controller.signal },
			{
				type: "message_update",
				message: { role: "assistant", content: [{ type: "toolCall", id: "tool", name: "bash" }] },
			},
			{ type: "tool_execution_start", toolCallId: "tool", toolName: "bash", args: {} },
			{ type: "tool_execution_end", toolCallId: "tool", toolName: "bash", result: {}, isError: false },
			{
				type: "message_end",
				message: { role: "assistant", content: [], stopReason: "toolUse" },
			},
		];
		const snapshots = events.map((event) => JSON.parse(JSON.stringify(event)) as unknown);
		const signalIdentity = events[0].signal;
		for (const [index, event] of events.entries()) {
			assert.equal(invoke(handlers, event.type, event, test.ctx), undefined);
			assert.deepEqual(JSON.parse(JSON.stringify(event)), snapshots[index]);
		}
		assert.equal(events[0].signal, signalIdentity);
		assert.equal(controller.signal.aborted, false);
		assert.equal(test.abortCalls(), 0);
		invoke(handlers, "agent_end", { type: "agent_end", messages: [] }, test.ctx);
		assert.equal(Object.hasOwn(test.tui, "doRender"), false);
	});

	it("shutdown handlers return undefined and are repeatable", () => {
		const test = createTestTuiContext();
		const handlers = registerHandlers();
		invoke(handlers, "session_start", { type: "session_start", reason: "startup" }, test.ctx);
		const event = { type: "session_shutdown", reason: "quit" };
		assert.equal(invoke(handlers, "session_shutdown", event, test.ctx), undefined);
		assert.equal(invoke(handlers, "session_shutdown", event, test.ctx), undefined);
		assert.deepEqual(event, { type: "session_shutdown", reason: "quit" });
	});
});
