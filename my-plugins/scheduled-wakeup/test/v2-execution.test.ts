import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AiSessionActions } from "../src/v2/ai-session-actions.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { SessionEntryLike, SessionEntryPort } from "../src/v2/session-entry-adapter.js";

const NOW = 50_000;

describe("Loop 2.0 execution", () => {
	it("excludes a concurrent process from executing the same registration and restores completed progress", () => {
		const roots = createRoots();
		const journal = createJournal();
		const first = createCore("same-session", journal.port, roots);
		const definition = first.createSharedDefinition("workspace", { prompt: "only once", schedule: { kind: "once", runAt: NOW } });
		const registration = first.registerSharedDefinition("workspace", definition.id);
		const second = createCore("same-session", journal.port, roots);
		const delivered: string[] = [];

		const result = first.executeRegistration(registration.id, (target) => {
			delivered.push(target.prompt);
			const concurrent = second.executeRegistration(registration.id, (nested) => {
				delivered.push(nested.prompt);
			});
			assert.deepEqual(concurrent, { kind: "locked", id: registration.id });
		});

		assert.deepEqual(result, { kind: "executed", id: registration.id, runCount: 1 });
		assert.deepEqual(delivered, ["only once"]);
		assert.equal(second.executeRegistration(registration.id, () => undefined).kind, "not-due");

		const restored = createCore("same-session", journal.port, roots);
		assert.deepEqual(restored.snapshotSessionState().registrations[0]?.progress, {
			status: "completed",
			runCount: 1,
			lastRunAt: NOW,
		});
		assert.deepEqual(restored.listActive(), []);
	});

	it("runs due session work once, leaves failed delivery retryable, and supports explicit cancellation", () => {
		const roots = createRoots();
		const journal = createJournal();
		const core = createCore("session-local", journal.port, roots);
		const failed = core.createSessionTask({ prompt: "retry me", schedule: { kind: "once", runAt: NOW } });
		const failure = core.executeSessionTask(failed.id, () => {
			throw new Error("delivery failed");
		});
		assert.equal(failure.kind, "failed");
		assert.equal(core.snapshotSessionState().tasks[0]?.progress.runCount, 0);
		assert.equal(core.executeSessionTask(failed.id, () => undefined).kind, "executed");

		const cancellable = core.createSessionTask({ prompt: "cancel me", schedule: { kind: "interval", intervalMs: 100 } });
		assert.equal(core.cancelSessionTask(cancellable.id), "cancelled");
		assert.equal(core.executeSessionTask(cancellable.id, () => undefined).kind, "missing");
	});

	it("returns busy when cancellation meets another task's state lock", () => {
		const roots = createRoots();
		const journal = createJournal();
		const core = createCore("session-cancellation", journal.port, roots);
		const blocker = core.createSessionTask({ prompt: "hold the state lock", schedule: { kind: "once", runAt: NOW } });
		const cancellable = core.createSessionTask({ prompt: "cancel me", schedule: { kind: "interval", intervalMs: 100 } });
		const definition = core.createSharedDefinition("workspace", {
			prompt: "unregister me",
			schedule: { kind: "once", runAt: NOW },
		});
		const registration = core.registerSharedDefinition("workspace", definition.id);
		const ai = new AiSessionActions(core);

		const execution = core.executeSessionTask(blocker.id, () => {
			assert.equal(core.cancelSessionTask(cancellable.id), "busy");
			assert.equal(core.unregisterSharedDefinition(registration.id), "busy");
			const response = ai.execute({ action: "cancel", id: cancellable.id });
			assert.equal(response.ok, false);
			assert.match(response.message, /busy/);
		});

		assert.equal(execution.kind, "executed");
		assert.equal(core.cancelSessionTask(cancellable.id), "cancelled");
		assert.equal(core.unregisterSharedDefinition(registration.id), "cancelled");
	});
});

type Roots = { workspace: string; global: string };

function createRoots(): Roots {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-v2-"));
	return { workspace: join(root, "workspace"), global: join(root, "global") };
}

function createCore(sessionId: string, sessionEntries: SessionEntryPort, roots: Roots): LoopV2Core {
	return new LoopV2Core({ sessionId, sessionEntries, workspaceRoot: roots.workspace, globalRoot: roots.global, now: () => NOW });
}

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
