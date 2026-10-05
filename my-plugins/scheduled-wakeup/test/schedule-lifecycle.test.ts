import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { SessionEntryLike, SessionEntryPort } from "../src/v2/session-entry-adapter.js";
import { parseSessionLoopState } from "../src/v2/session-state-codec.js";

const NOW = 1_700_000_000_000;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("session schedule suspension and expiration", () => {
	it("resumes the three remaining minutes of a ten-minute interval after days offline", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({ prompt: "tick", schedule: { kind: "interval", intervalMs: 600_000 } });
		setup.clock.value += 420_000;
		setup.core.suspendSchedules();
		assert.deepEqual(setup.core.snapshotSessionState().tasks[0]?.progress, { status: "active", nextRunAt: NOW + 600_000, runCount: 0, suspendedAt: NOW + 420_000 });
		setup.clock.value += 3 * 86_400_000;
		const restored = new LoopV2Core(setup.options);
		restored.resumeSchedules();
		assert.deepEqual(restored.snapshotSessionState().tasks[0]?.progress, { status: "active", nextRunAt: setup.clock.value + 180_000, runCount: 0 });
		const entryCount = setup.entries.length;
		restored.resumeSchedules();
		assert.equal(setup.entries.length, entryCount);
		setup.clock.value += 179_999;
		assert.deepEqual(restored.runDue(() => assert.fail("not due")), []);
		setup.clock.value += 1;
		assert.equal(restored.executeSessionTask(task.id, () => undefined).kind, "executed");
		assert.deepEqual(restored.snapshotSessionState().tasks[0]?.progress, { status: "active", nextRunAt: setup.clock.value + 600_000, runCount: 1, lastRunAt: setup.clock.value });
	});

	it("expires past one-shots on resume without delivery, execution history, or reactivation", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({ prompt: "once", schedule: { kind: "once", runAt: NOW + 60_000 } });
		setup.clock.value += 10_000;
		setup.core.suspendSchedules();
		setup.clock.value += 3_600_000;
		const restored = new LoopV2Core(setup.options);
		restored.resumeSchedules();
		assert.deepEqual(restored.snapshotSessionState().tasks[0]?.progress, { status: "expired", runCount: 0, expiredAt: setup.clock.value });
		assert.deepEqual(restored.listActive(), []);
		assert.deepEqual(restored.runDue(() => assert.fail("expired")), []);
		assert.deepEqual(restored.deferActive(task.id, { kind: "delay", delayMs: 10_000 }), { kind: "inactive" });
		assert.equal(new LoopV2Core(setup.options).snapshotSessionState().tasks[0]?.progress.status, "expired");
	});

	it("keeps future and exact-resume one-shot deadlines absolute", () => {
		const setup = createSetup();
		setup.core.createSessionTask({ prompt: "future", schedule: { kind: "once", runAt: NOW + 120_000 } });
		const exact = setup.core.createSessionTask({ prompt: "exact", schedule: { kind: "once", runAt: NOW + 60_000 } });
		setup.clock.value += 10_000;
		setup.core.suspendSchedules();
		setup.clock.value = NOW + 60_000;
		setup.core.resumeSchedules();
		assert.deepEqual(setup.core.snapshotSessionState().tasks[0]?.progress, { status: "active", nextRunAt: NOW + 120_000, runCount: 0 });
		assert.equal(setup.core.executeSessionTask(exact.id, () => undefined).kind, "executed");
	});

	it("uses deferred deadlines and preserves the deferred interval countdown", () => {
		const setup = createSetup();
		const once = setup.core.createSessionTask({ prompt: "once", schedule: { kind: "once", runAt: NOW + 60_000 } });
		const recurring = setup.core.createSessionTask({ prompt: "interval", schedule: { kind: "interval", intervalMs: 60_000 } });
		for (const id of [once.id, recurring.id]) setup.core.deferActive(id, { kind: "delay", delayMs: 120_000 });
		setup.clock.value += 30_000;
		setup.core.suspendSchedules();
		setup.clock.value = NOW + 120_000;
		setup.core.resumeSchedules();
		assert.deepEqual(setup.core.snapshotSessionState().tasks.map((task) => task.progress), [
			{ status: "active", nextRunAt: NOW + 180_000, runCount: 0 }, { status: "active", nextRunAt: NOW + 270_000, runCount: 0 },
		]);
		setup.core.suspendSchedules();
		setup.clock.value = NOW + 180_001;
		setup.core.resumeSchedules();
		assert.equal(setup.core.snapshotSessionState().tasks[0]?.progress.status, "expired");
	});

	it("suspends shared registrations privately without modifying either catalog", () => {
		for (const scope of ["workspace", "global"] as const) {
			const setup = createSetup();
			const definition = setup.core.createSharedDefinition(scope, { prompt: "shared", schedule: { kind: "interval", intervalMs: 600_000 } });
			const registration = setup.core.registerSharedDefinition(scope, definition.id);
			const other = new LoopV2Core({ ...setup.options, sessionId: "other", sessionEntries: journal([]) });
			const otherRegistration = other.registerSharedDefinition(scope, definition.id);
			const catalog = join(scope === "workspace" ? setup.options.workspaceRoot : setup.options.globalRoot, ".pi", "scheduled-wakeup", "v2", `${scope}-definitions.json`);
			const before = readFileSync(catalog, "utf8");
			setup.clock.value += 420_000;
			setup.core.suspendSchedules();
			setup.clock.value += 86_400_000;
			setup.core.resumeSchedules();
			assert.deepEqual(setup.core.snapshotSessionState().registrations[0]?.progress, { status: "active", nextRunAt: setup.clock.value + 180_000, runCount: 0 });
			assert.equal(setup.core.snapshotSessionState().registrations[0]?.id, registration.id);
			assert.deepEqual(other.snapshotSessionState().registrations[0], otherRegistration);
			assert.equal(readFileSync(catalog, "utf8"), before);
		}
	});

	it("restores unavailable shared registrations only after their catalog recovers", () => {
		const setup = createSetup();
		const definition = setup.core.createSharedDefinition("workspace", { prompt: "shared", schedule: { kind: "interval", intervalMs: 600_000 } });
		const registration = setup.core.registerSharedDefinition("workspace", definition.id);
		const catalog = join(setup.options.workspaceRoot, ".pi", "scheduled-wakeup", "v2", "workspace-definitions.json");
		const before = readFileSync(catalog, "utf8");
		setup.clock.value += 420_000;
		setup.core.suspendSchedules();
		writeFileSync(catalog, "{", "utf8");
		setup.clock.value += 86_400_000;
		setup.core.resumeSchedules();
		assert.equal(setup.core.executeRegistration(registration.id, () => assert.fail("unavailable")).kind, "unavailable");
		assert.equal(setup.core.snapshotSessionState().registrations[0]?.progress.status, "active");
		writeFileSync(catalog, before, "utf8");
		assert.equal(setup.core.executeRegistration(registration.id, () => assert.fail("still three minutes left")).kind, "not-due");
		assert.deepEqual(setup.core.snapshotSessionState().registrations[0]?.progress, { status: "active", nextRunAt: setup.clock.value + 180_000, runCount: 0 });
	});

	it("expires shared one-shots without deleting index membership", () => {
		const setup = createSetup();
		const definition = setup.core.createSharedDefinition("global", { prompt: "once", schedule: { kind: "once", runAt: NOW + 60_000 } });
		setup.core.registerSharedDefinition("global", definition.id);
		setup.core.suspendSchedules();
		setup.clock.value += 60_001;
		setup.core.resumeSchedules();
		assert.deepEqual(setup.core.listActive(), []);
		assert.deepEqual(setup.core.listAvailable(), []);
		assert.equal(setup.core.snapshotSessionState().registrations[0]?.progress.status, "expired");
	});

	it("does not fabricate a remaining time if no shutdown marker was saved", () => {
		const setup = createSetup();
		setup.core.createSessionTask({ prompt: "interval", schedule: { kind: "interval", intervalMs: 60_000 } });
		setup.core.createSessionTask({ prompt: "once", schedule: { kind: "once", runAt: NOW + 60_000 } });
		setup.clock.value += 3_600_000;
		setup.core.resumeSchedules();
		assert.deepEqual(setup.core.snapshotSessionState().tasks[0]?.progress, { status: "active", nextRunAt: NOW + 60_000, runCount: 0 });
		assert.equal(setup.core.snapshotSessionState().tasks[1]?.progress.status, "expired");
	});

	it("persists each transition atomically and leaves the old snapshot after append failure", () => {
		const setup = createSetup();
		setup.core.createSessionTask({ prompt: "one", schedule: { kind: "interval", intervalMs: 60_000 } });
		setup.core.createSessionTask({ prompt: "two", schedule: { kind: "interval", intervalMs: 60_000 } });
		const before = setup.core.snapshotSessionState();
		const append = setup.options.sessionEntries.appendEntry;
		setup.options.sessionEntries.appendEntry = () => { throw new Error("append failed"); };
		assert.throws(() => setup.core.suspendSchedules(), /append failed/);
		assert.deepEqual(setup.core.snapshotSessionState(), before);
		setup.options.sessionEntries.appendEntry = append;
		const count = setup.entries.length;
		setup.core.suspendSchedules();
		assert.equal(setup.entries.length, count + 1);
		setup.core.suspendSchedules();
		assert.equal(setup.entries.length, count + 1);
		for (const task of setup.core.snapshotSessionState().tasks) assert.equal(task.progress.status === "active" ? task.progress.suspendedAt : undefined, NOW);
	});

	it("rejects invalid persisted suspension and expiration timestamps", () => {
		const setup = createSetup();
		setup.core.createSessionTask({ prompt: "once", schedule: { kind: "once", runAt: NOW + 60_000 } });
		const state = setup.core.snapshotSessionState();
		const task = state.tasks[0];
		assert.ok(task);
		for (const progress of [{ ...task.progress, suspendedAt: -1 }, { status: "expired", runCount: 0, expiredAt: "bad" }]) {
			assert.equal(parseSessionLoopState({ ...state, tasks: [{ ...task, progress }] }), undefined);
		}
	});
});

function createSetup() {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-lifecycle-"));
	roots.push(root);
	const entries: SessionEntryLike[] = [];
	const clock = { value: NOW };
	const options = { sessionId: "lifecycle", sessionEntries: journal(entries), workspaceRoot: join(root, "workspace"), globalRoot: join(root, "global"), now: () => clock.value };
	return { entries, clock, options, core: new LoopV2Core(options) };
}
function journal(entries: SessionEntryLike[]): SessionEntryPort {
	return { getBranch: () => entries, appendEntry: (customType, data) => { entries.push({ type: "custom", customType, data }); } };
}
