import assert from "node:assert/strict";
import { test } from "node:test";
import { syncLoopBoulderInhibition, type LoopInhibitionState } from "../../boulder-inhibition/loop-inhibition.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { sessionBoundService } from "./session-bound-service.ts";

function specialTasks(count: number): LoopInhibitionState {
	return {
		tasks: Array.from({ length: count }, () => ({ definition: { inhibitBoulder: true }, progress: { status: "active" } })),
		registrations: [],
	};
}

test("sync: missing loop entry writes an explicit initial false, then reports clear", () => {
	const branch = new InMemoryBranch();
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(`reportInfo:${text}`); },
	});
	assert.deepEqual(syncLoopBoulderInhibition(specialTasks(0), () => { assert.fail("no registrations"); }, service.client), {
		ok: true, written: true, snapshot: { states: [{ type: "loop", value: false }], blockers: [], inhibited: false },
	});
	assert.deepEqual(branch.entries, [signalEntry("loop", false)]);
	assert.deepEqual(branch.events, [
		"getBranch", "appendEntry", "getBranch", "reportInfo:Boulder signal loop=false; Boulder inhibition clear",
	]);
});

test("sync: initial true preserves every other source and obeys write ordering", () => {
	const branch = new InMemoryBranch([signalEntry("user", true)]);
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(`reportInfo:${text}`); },
	});
	assert.deepEqual(syncLoopBoulderInhibition(specialTasks(1), () => { assert.fail("no registrations"); }, service.client), {
		ok: true, written: true, snapshot: {
			states: [{ type: "loop", value: true }, { type: "user", value: true }],
			blockers: ["loop", "user"], inhibited: true,
		},
	});
	assert.deepEqual(branch.entries, [signalEntry("user", true), signalEntry("loop", true)]);
	assert.deepEqual(branch.events, [
		"getBranch", "appendEntry", "getBranch", "cancelWait",
		"reportInfo:Boulder signal loop=true; Boulder inhibited: loop, user",
	]);
});

test("sync: matching true or false never appends, cancels, or reports, even if inhibited", () => {
	for (const value of [true, false]) {
		const branch = new InMemoryBranch([signalEntry("loop", value), signalEntry("user", true)]);
		const service = sessionBoundService(branch, {
			cancelWait: () => { branch.events.push("cancelWait"); },
			reportInfo: () => { branch.events.push("reportInfo"); },
		});
		for (let repeat = 0; repeat < 3; repeat++) {
			assert.deepEqual(syncLoopBoulderInhibition(specialTasks(value ? 1 : 0), () => {
				assert.fail("no registrations");
			}, service.client), {
				ok: true, written: false, snapshot: {
					states: [{ type: "user", value: true }, { type: "loop", value }],
					blockers: value ? ["user", "loop"] : ["user"], inhibited: true,
				},
			});
		}
		assert.deepEqual(branch.events, ["getBranch", "getBranch", "getBranch"]);
		assert.equal(service.bus.emissions.length, 3);
		assert.deepEqual(branch.entries, [signalEntry("loop", value), signalEntry("user", true)]);
	}
});

test("sync: removing one of two special tasks keeps true; removing the last closes once", () => {
	const branch = new InMemoryBranch();
	const effects = {
		cancelWait: (): void => { branch.events.push("cancelWait"); },
		reportInfo: (text: string): void => { branch.events.push(`reportInfo:${text}`); },
	};
	const service = sessionBoundService(branch, effects);
	const results = [2, 1, 0, 0].map((count) => syncLoopBoulderInhibition(specialTasks(count), () => {
		assert.fail("no registrations");
	}, service.client));
	assert.equal(service.bus.emissions.length, 6);
	assert.deepEqual(results.map((result) => result.ok && result.written), [true, false, true, false]);
	assert.deepEqual(results.map((result) => result.ok ? result.snapshot.inhibited : undefined), [true, true, false, false]);
	assert.deepEqual(branch.entries, [signalEntry("loop", true), signalEntry("loop", false)]);
	assert.deepEqual(branch.events, [
		"getBranch", "appendEntry", "getBranch", "cancelWait", "reportInfo:Boulder signal loop=true; Boulder inhibited: loop",
		"getBranch", "getBranch", "appendEntry", "getBranch", "reportInfo:Boulder signal loop=false; Boulder inhibition clear",
		"getBranch",
	]);
});

test("sync: completed, expired, or ordinary tasks release loop while preserving a sibling blocker", () => {
	const cases: LoopInhibitionState["tasks"][] = [
		[{ definition: { inhibitBoulder: true }, progress: { status: "completed" } }],
		[{ definition: { inhibitBoulder: true }, progress: { status: "expired" } }],
		[{ definition: { inhibitBoulder: false }, progress: { status: "active" } }],
		[{ definition: {}, progress: { status: "active" } }],
	];
	for (const tasks of cases) {
		const branch = new InMemoryBranch([signalEntry("loop", true), signalEntry("user", true)]);
		const service = sessionBoundService(branch, {
			cancelWait: () => { branch.events.push("cancelWait"); },
			reportInfo: (text) => { branch.events.push(`reportInfo:${text}`); },
		});
		assert.deepEqual(syncLoopBoulderInhibition({ tasks, registrations: [] }, () => {
			assert.fail("no registrations");
		}, service.client), {
			ok: true, written: true, snapshot: {
				states: [{ type: "loop", value: false }, { type: "user", value: true }],
				blockers: ["user"], inhibited: true,
			},
		});
		assert.deepEqual(branch.entries, [signalEntry("loop", true), signalEntry("user", true), signalEntry("loop", false)]);
		assert.deepEqual(branch.events, [
			"getBranch", "appendEntry", "getBranch", "cancelWait", "reportInfo:Boulder signal loop=false; Boulder inhibited: user",
		]);
	}
});

test("sync: compares the latest valid loop entry, not a newer malformed value", () => {
	for (const value of [true, false]) {
		const branch = new InMemoryBranch([
			signalEntry("loop", !value), signalEntry("loop", value),
			{ type: "custom", customType: "OMPv2InhibitBoulder", data: { type: "loop", value: String(!value) } },
		]);
		const service = sessionBoundService(branch, {
			cancelWait: () => { branch.events.push("cancelWait"); },
			reportInfo: () => { branch.events.push("reportInfo"); },
		});
		assert.deepEqual(syncLoopBoulderInhibition(specialTasks(value ? 1 : 0), () => {
			assert.fail("no registrations");
		}, service.client), {
			ok: true, written: false, snapshot: {
				states: [{ type: "loop", value }], blockers: value ? ["loop"] : [], inhibited: value,
			},
		});
		assert.equal(branch.entries.length, 3);
		assert.deepEqual(branch.events, ["getBranch"]);
	}
});
