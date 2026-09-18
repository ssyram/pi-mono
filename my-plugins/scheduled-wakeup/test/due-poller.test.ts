import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DuePoller, type DuePollerTimers, type TimerHandle } from "../src/v2/due-poller.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { SessionEntryLike, SessionEntryPort } from "../src/v2/session-entry-adapter.js";

const NOW = 1_000_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

describe("DuePoller", () => {
	it("arms the nearest nextRunAt, delivers due work, and re-arms recurring tasks", () => {
		const clock = { value: NOW };
		const timers = createManualTimers();
		const core = createCore(createJournal().port, clock);
		core.createSessionTask({ prompt: "tick", schedule: { kind: "interval", intervalMs: 300_000 } });
		const delivered: string[] = [];
		const poller = new DuePoller({ core, deliver: (target) => delivered.push(target.prompt), now: () => clock.value, timers: timers.timers });

		poller.start();
		assert.equal(timers.pending(), true);
		assert.equal(timers.lastDelay(), 300_000);

		clock.value = NOW + 300_000;
		timers.fire();
		assert.deepEqual(delivered, ["tick"]);
		assert.equal(timers.pending(), true);
		assert.equal(timers.lastDelay(), 300_000);
		assert.equal(core.snapshotSessionState().tasks[0]?.progress.runCount, 1);
		poller.dispose();
	});

	it("chunks oversized waits through MAX_TIMEOUT and resumes with the remainder", () => {
		const clock = { value: NOW };
		const timers = createManualTimers();
		const core = createCore(createJournal().port, clock);
		core.createSessionTask({ prompt: "far future", schedule: { kind: "once", runAt: NOW + MAX_TIMEOUT_MS + 10_000_000 } });
		const poller = new DuePoller({ core, deliver: () => undefined, now: () => clock.value, timers: timers.timers });

		poller.start();
		assert.equal(timers.lastDelay(), MAX_TIMEOUT_MS);
		clock.value = NOW + MAX_TIMEOUT_MS;
		timers.fire();
		assert.equal(timers.pending(), true);
		assert.equal(timers.lastDelay(), 10_000_000);
		poller.dispose();
	});

	it("clears the timer when the active set empties and stops cleanly", () => {
		const clock = { value: NOW };
		const timers = createManualTimers();
		const core = createCore(createJournal().port, clock);
		core.createSessionTask({ prompt: "once", schedule: { kind: "once", runAt: NOW + 1_000 } });
		const delivered: string[] = [];
		const poller = new DuePoller({ core, deliver: (target) => delivered.push(target.prompt), now: () => clock.value, timers: timers.timers });

		poller.start();
		assert.equal(timers.pending(), true);
		clock.value = NOW + 1_000;
		timers.fire();
		assert.deepEqual(delivered, ["once"]);
		assert.equal(timers.pending(), false);

		poller.stop();
		assert.equal(timers.pending(), false);
		assert.equal(poller.isRunning, false);
		poller.reschedule();
		assert.equal(timers.pending(), false);
		poller.dispose();
	});

	it("reschedules after mutations and backs off when delivery keeps failing", () => {
		const clock = { value: NOW };
		const timers = createManualTimers();
		const core = createCore(createJournal().port, clock);
		const poller = new DuePoller({ core, deliver: () => { throw new Error("down"); }, now: () => clock.value, timers: timers.timers });

		poller.start();
		assert.equal(timers.pending(), false);

		const task = core.createSessionTask({ prompt: "retry me", schedule: { kind: "once", runAt: NOW + 5_000 } });
		poller.reschedule();
		assert.equal(timers.pending(), true);
		assert.equal(timers.lastDelay(), 5_000);

		clock.value = NOW + 5_000;
		timers.fire();
		assert.equal(timers.pending(), true);
		assert.equal(timers.lastDelay(), 60_000);

		assert.equal(core.cancelSessionTask(task.id), "cancelled");
		poller.reschedule();
		assert.equal(timers.pending(), false);
		poller.dispose();
	});

	it("unrefs normal timers and keeps runner timers referenced", () => {
		const original = globalThis.setTimeout;
		const handles: ReturnType<typeof setTimeout>[] = [];
		globalThis.setTimeout = ((handler: () => void, timeout?: number) => {
			const handle = original(handler, timeout);
			handles.push(handle);
			return handle;
		}) as typeof setTimeout;
		let normal: DuePoller | undefined;
		let runner: DuePoller | undefined;
		try {
			normal = startWithKeepAlive(false);
			const normalHandle = handles.at(-1);
			runner = startWithKeepAlive(true);
			const runnerHandle = handles.at(-1);
			assert.equal(normalHandle?.hasRef(), false);
			assert.equal(runnerHandle?.hasRef(), true);
		} finally {
			globalThis.setTimeout = original;
			normal?.dispose();
			runner?.dispose();
		}
	});
});

function startWithKeepAlive(keepAlive: boolean): DuePoller {
	const core = createCore(createJournal().port, { value: Date.now() });
	core.createSessionTask({ prompt: "later", schedule: { kind: "interval", intervalMs: 3_600_000 } });
	const poller = new DuePoller({ core, deliver: () => undefined, keepAlive });
	poller.start();
	return poller;
}

function createCore(port: SessionEntryPort, clock: { value: number }): LoopV2Core {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-poller-"));
	return new LoopV2Core({
		sessionId: "poller-session",
		sessionEntries: port,
		workspaceRoot: join(root, "workspace"),
		globalRoot: join(root, "global"),
		now: () => clock.value,
	});
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

function createManualTimers(): { timers: DuePollerTimers; pending(): boolean; lastDelay(): number | undefined; fire(): void } {
	let handler: (() => void) | undefined;
	let delay: number | undefined;
	let handle: TimerHandle | undefined;
	const timers: DuePollerTimers = {
		set: (next, timeoutMs) => {
			handler = next;
			delay = timeoutMs;
			handle = {};
			return handle;
		},
		clear: (target) => {
			if (target === handle) handler = undefined;
		},
	};
	return {
		timers,
		pending: () => handler !== undefined,
		lastDelay: () => delay,
		fire: () => {
			const next = handler;
			handler = undefined;
			next?.();
		},
	};
}
