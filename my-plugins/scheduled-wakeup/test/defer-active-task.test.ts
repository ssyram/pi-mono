import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { DeferTime } from "../src/v2/defer-active-task.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import { RegistrationExecutionLock } from "../src/v2/registration-execution-lock.js";
import type { SessionEntryLike, SessionEntryPort } from "../src/v2/session-entry-adapter.js";
import { UserLoopV2Commands } from "../src/v2/user-commands.js";

const NOW = 1_700_000_000_000;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Loop defer progress", () => {
	it("extends repeated durations without changing schedule or execution history, and survives restart", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({ prompt: "tick", schedule: { kind: "interval", intervalMs: 60_000 } });
		setup.clock.value += 60_000;
		assert.equal(setup.core.executeSessionTask(task.id, () => undefined).kind, "executed");
		const before = setup.core.snapshotSessionState().tasks[0];
		assert.ok(before);
		assert.deepEqual(new UserLoopV2Commands(setup.core).deferActiveTask(task.id, { kind: "delay", delayMs: 600_000 }), { kind: "deferred", nextRunAt: NOW + 720_000 });
		assert.deepEqual(setup.core.deferActive(task.id, { kind: "delay", delayMs: 600_000 }), { kind: "deferred", nextRunAt: NOW + 1_320_000 });
		const restarted = new LoopV2Core(setup.options);
		assert.deepEqual(restarted.snapshotSessionState().tasks[0], {
			definition: before.definition, progress: { ...before.progress, nextRunAt: NOW + 1_320_000 },
		});
		setup.clock.value = NOW + 120_000;
		assert.deepEqual(restarted.runDue(() => assert.fail("must not run at the old time")), []);
		setup.clock.value = NOW + 1_320_000;
		assert.equal(restarted.runDue(() => undefined)[0]?.kind, "executed");
		assert.deepEqual(restarted.snapshotSessionState().tasks[0]?.progress, {
			status: "active", nextRunAt: NOW + 1_380_000, runCount: 2, lastRunAt: setup.clock.value,
		});
	});

	it("defers an overdue one-shot from now, then completes once", () => {
		const { core, clock } = createSetup();
		const task = core.createSessionTask({ prompt: "once", schedule: { kind: "once", runAt: NOW - 60_000 } });
		assert.deepEqual(core.deferActive(task.id, { kind: "delay", delayMs: 10_000 }), { kind: "deferred", nextRunAt: NOW + 10_000 });
		assert.deepEqual(core.runDue(() => assert.fail("still deferred")), []);
		clock.value += 10_000;
		assert.equal(core.runDue(() => undefined)[0]?.kind, "executed");
		assert.deepEqual(core.snapshotSessionState().tasks[0]?.progress, { status: "completed", runCount: 1, lastRunAt: clock.value });
		const before = core.snapshotSessionState();
		assert.deepEqual(core.deferActive(task.id, { kind: "delay", delayMs: 10_000 }), { kind: "inactive" });
		assert.deepEqual(core.snapshotSessionState(), before);
	});

	it("sets an absolute next run and rejects earlier, invalid, or overflowing times without writing", () => {
		const { core, entries } = createSetup();
		const task = core.createSessionTask({ prompt: "once", schedule: { kind: "once", runAt: NOW + 60_000 } });
		assert.deepEqual(core.deferActive(task.id, { kind: "at", runAt: NOW + 120_000 }), { kind: "deferred", nextRunAt: NOW + 120_000 });
		const before = core.snapshotSessionState();
		const length = entries.length;
		const invalid: DeferTime[] = [
			{ kind: "at", runAt: NOW - 1 }, { kind: "at", runAt: NOW + 60_000 }, { kind: "at", runAt: NOW + 120_000 },
			{ kind: "at", runAt: NaN }, { kind: "at", runAt: NOW + 120_000.5 }, { kind: "at", runAt: 8_640_000_000_000_001 },
			{ kind: "delay", delayMs: 0 }, { kind: "delay", delayMs: -1 }, { kind: "delay", delayMs: 1.5 },
			{ kind: "delay", delayMs: Number.MAX_SAFE_INTEGER }, { kind: "delay", delayMs: Infinity },
		];
		for (const time of invalid) assert.equal(core.deferActive(task.id, time).kind, "invalid-time");
		assert.deepEqual(core.deferActive("session:missing", { kind: "delay", delayMs: 1_000 }), { kind: "missing" });
		assert.deepEqual(core.deferActive("registration:global:missing", { kind: "delay", delayMs: 1_000 }), { kind: "missing" });
		assert.equal(entries.length, length);
		assert.deepEqual(core.snapshotSessionState(), before);
	});

	it("keeps both shared scopes and another session's registrations unchanged", () => {
		for (const scope of ["workspace", "global"] as const) {
			const setup = createSetup();
			const otherEntries: SessionEntryLike[] = [];
			const other = new LoopV2Core({ ...setup.options, sessionId: "other-session", sessionEntries: journal(otherEntries) });
			const definition = setup.core.createSharedDefinition(scope, { prompt: "shared", schedule: { kind: "interval", intervalMs: 60_000 } });
			const registration = setup.core.registerSharedDefinition(scope, definition.id);
			const otherRegistration = other.registerSharedDefinition(scope, definition.id);
			const catalog = join(scope === "workspace" ? setup.options.workspaceRoot : setup.options.globalRoot, ".pi", "scheduled-wakeup", "v2", `${scope}-definitions.json`);
			const catalogBefore = readFileSync(catalog, "utf8");
			assert.deepEqual(setup.core.deferActive(registration.id, { kind: "delay", delayMs: 10_000 }), { kind: "deferred", nextRunAt: NOW + 70_000 });
			assert.equal(readFileSync(catalog, "utf8"), catalogBefore);
			assert.deepEqual(other.snapshotSessionState().registrations[0], otherRegistration);
			setup.clock.value += 60_000;
			assert.deepEqual(setup.core.runDue(() => assert.fail("deferred registration")), []);
			assert.equal(other.runDue(() => undefined)[0]?.kind, "executed");
			setup.clock.value += 10_000;
			assert.equal(setup.core.runDue(() => undefined)[0]?.kind, "executed");
			assert.deepEqual(setup.core.snapshotSessionState().registrations[0]?.progress, { status: "active", nextRunAt: NOW + 130_000, runCount: 1, lastRunAt: setup.clock.value });
		}
	});

	it("does not mutate when either target execution lock or session state lock is held", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({ prompt: "local", schedule: { kind: "interval", intervalMs: 60_000 } });
		const definition = setup.core.createSharedDefinition("global", { prompt: "shared", schedule: { kind: "interval", intervalMs: 60_000 } });
		const registration = setup.core.registerSharedDefinition("global", definition.id);
		const locks = new RegistrationExecutionLock(join(setup.options.workspaceRoot, ".pi", "scheduled-wakeup", "v2", "locks"), setup.options.sessionId);
		const before = setup.core.snapshotSessionState();
		for (const [id, resource] of [[task.id, `task:${task.id}`], [registration.id, `registration:${registration.id}`], [task.id, "state"]] as const) {
			const held = locks.tryAcquire(resource);
			assert.ok(held);
			try { assert.deepEqual(setup.core.deferActive(id, { kind: "delay", delayMs: 10_000 }), { kind: "busy" }); }
			finally { held.release(); }
			assert.deepEqual(setup.core.snapshotSessionState(), before);
		}
		assert.equal(setup.core.deferActive(task.id, { kind: "delay", delayMs: 10_000 }).kind, "deferred");
	});

	it("keeps persisted progress unchanged on append failure and releases locks", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({ prompt: "local", schedule: { kind: "interval", intervalMs: 60_000 } });
		const before = setup.core.snapshotSessionState();
		const append = setup.options.sessionEntries.appendEntry;
		setup.options.sessionEntries.appendEntry = () => { throw new Error("append failed"); };
		assert.throws(() => setup.core.deferActive(task.id, { kind: "delay", delayMs: 10_000 }), /append failed/);
		assert.deepEqual(setup.core.snapshotSessionState(), before);
		setup.options.sessionEntries.appendEntry = append;
		assert.equal(setup.core.deferActive(task.id, { kind: "delay", delayMs: 10_000 }).kind, "deferred");
	});
});

function createSetup() {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-defer-"));
	roots.push(root);
	const entries: SessionEntryLike[] = [];
	const clock = { value: NOW };
	const options = {
		sessionId: "defer-session", sessionEntries: journal(entries), workspaceRoot: join(root, "workspace"), globalRoot: join(root, "global"), now: () => clock.value,
	};
	return { root, entries, clock, options, core: new LoopV2Core(options) };
}

function journal(entries: SessionEntryLike[]): SessionEntryPort {
	return { getBranch: () => entries, appendEntry: (customType, data) => { entries.push({ type: "custom", customType, data }); } };
}
