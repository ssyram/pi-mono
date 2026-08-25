import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerBoulderBackgroundWork } from "../hooks/boulder-background-work.js";

function context(sessionId: string): ExtensionContext {
	return {
		sessionManager: {
			getSessionFile: () => sessionId,
			getSessionId: () => sessionId,
		},
	} as unknown as ExtensionContext;
}

function harness(): {
	pi: ExtensionAPI;
	emit(event: string, payload: unknown): void;
} {
	const handlers = new Map<string, Array<(payload: unknown) => void>>();
	const emit = (event: string, payload: unknown): void => {
		for (const handler of handlers.get(event) ?? []) handler(payload);
	};
	return {
		pi: {
			on: () => undefined,
			events: {
				on: (event: string, handler: (payload: unknown) => void) => {
					const eventHandlers = handlers.get(event) ?? [];
					eventHandlers.push(handler);
					handlers.set(event, eventHandlers);
					return () => undefined;
				},
				emit,
			},
		} as unknown as ExtensionAPI,
		emit,
	};
}

describe("Boulder background work", () => {
	it("tracks async subagent lifecycle by owning session", () => {
		const testHarness = harness();
		const work = registerBoulderBackgroundWork(testHarness.pi);
		testHarness.emit("subagent:async-started", { id: "run-1", sessionId: "session-a" });
		assert.equal(work.isActive(context("session-a")), true);
		assert.equal(work.isActive(context("session-b")), false);
		testHarness.emit("subagent:async-complete", { runId: "run-1", sessionId: "session-a" });
		assert.equal(work.isActive(context("session-a")), false);
	});

});
