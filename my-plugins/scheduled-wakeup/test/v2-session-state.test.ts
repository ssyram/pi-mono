import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialProgress, type SessionTask } from "../src/v2/model.js";
import {
	SESSION_LOOP_STATE_ENTRY_TYPE,
	SessionEntryAdapter,
	type SessionEntryLike,
	type SessionEntryPort,
} from "../src/v2/session-entry-adapter.js";

const TASK: SessionTask = {
	definition: {
		id: "session:one",
		scope: "session",
		prompt: "check state",
		schedule: { kind: "once", runAt: 100 },
		createdAt: 10,
	},
	progress: { status: "active", nextRunAt: 100, runCount: 0 },
};

describe("Loop 2.0 session custom-entry state", () => {
	it("persists reducer snapshots as plain custom entries and restores the newest valid snapshot", () => {
		const journal = createJournal();
		const adapter = new SessionEntryAdapter(journal.port);
		adapter.dispatch({ kind: "add-task", task: TASK });
		journal.entries.push({ type: "custom", customType: SESSION_LOOP_STATE_ENTRY_TYPE, data: { version: 1, tasks: "invalid", registrations: [] } });
		adapter.dispatch({ kind: "advance-task", taskId: TASK.definition.id, progress: { status: "completed", runCount: 1, lastRunAt: 100 } });

		assert.equal(journal.entries.every((entry) => entry.type === "custom"), true);
		assert.equal(journal.entries[0]?.customType, SESSION_LOOP_STATE_ENTRY_TYPE);
		const restored = new SessionEntryAdapter(journal.port).snapshot();
		assert.deepEqual(restored.tasks[0]?.progress, { status: "completed", runCount: 1, lastRunAt: 100 });
	});

	it("rejects interval progress that would overflow a persisted timestamp", () => {
		assert.throws(
			() => initialProgress({ kind: "interval", intervalMs: 1 }, Number.MAX_SAFE_INTEGER),
			/safe integer range/,
		);
	});

	it("does not mutate in-memory state when custom-entry persistence fails", () => {
		const port: SessionEntryPort = {
			getBranch: () => [],
			appendEntry: () => {
				throw new Error("session storage unavailable");
			},
		};
		const adapter = new SessionEntryAdapter(port);
		assert.throws(() => adapter.dispatch({ kind: "add-task", task: TASK }), /session storage unavailable/);
		assert.deepEqual(adapter.snapshot().tasks, []);
	});
});

function createJournal(): { entries: SessionEntryLike[]; port: SessionEntryPort } {
	const entries: SessionEntryLike[] = [];
	return {
		entries,
		port: {
			getBranch: () => entries,
			appendEntry: (customType, data) => {
				entries.push({ type: "custom", customType, data });
			},
		},
	};
}
