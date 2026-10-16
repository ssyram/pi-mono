import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerBackgroundWorkProvider } from "../../../third-party-plugins/pi-subagents/src/api/background-work.js";
import { createBoulderBackgroundWork } from "../hooks/boulder-background-work.js";

function context(sessionId: string): ExtensionContext {
	return {
		sessionManager: {
			getSessionFile: () => sessionId,
			getSessionId: () => sessionId,
		},
	} as unknown as ExtensionContext;
}

describe("Boulder background work", () => {
	it("reads live work for the owning session on every check", () => {
		const activeSessions = new Set(["session-a"]);
		const work = createBoulderBackgroundWork((sessionId) => activeSessions.has(sessionId));

		assert.equal(work.isActive(context("session-a")), true);
		assert.equal(work.isActive(context("session-b")), false);

		activeSessions.delete("session-a");
		assert.equal(work.isActive(context("session-a")), false);
	});

	it("reads the current provider snapshot without lifecycle events", () => {
		let active = true;
		const dispose = registerBackgroundWorkProvider({
			name: "boulder-background-work-test",
			listActiveWork: () => active ? [{ id: "run-1", sessionId: "session-a" }] : [],
		});
		try {
			const work = createBoulderBackgroundWork();
			assert.equal(work.isActive(context("session-a")), true);
			active = false;
			assert.equal(work.isActive(context("session-a")), false);
		} finally {
			dispose();
		}
	});
});
