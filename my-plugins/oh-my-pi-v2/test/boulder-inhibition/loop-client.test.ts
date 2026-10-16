import assert from "node:assert/strict";
import { test } from "node:test";
import { syncLoopBoulderInhibition, type LoopInhibitionState } from "../../boulder-inhibition/loop-inhibition.ts";
import type { BoulderInhibitionSnapshot } from "../../boulder-inhibition/protocol.ts";
import type { BoulderClientResult, BoulderInhibitionClient, BoulderInhibitionFailure } from "../../boulder-inhibition/service-protocol.ts";

test("sync client: aggregation finishes before get, then one set supplies the returned snapshot", () => {
	const state: LoopInhibitionState = { tasks: [], registrations: [{
		id: "shared", reference: { scope: "global", definitionId: "definition" },
		registeredAt: 1, progress: { status: "active" },
	}] };
	const before = structuredClone(state);
	const initial: BoulderInhibitionSnapshot = {
		states: [{ type: "user", value: true }], blockers: ["user"], inhibited: true,
	};
	const written: BoulderInhibitionSnapshot = {
		states: [{ type: "loop", value: true }, { type: "user", value: true }],
		blockers: ["loop", "user"], inhibited: true,
	};
	const calls: string[] = [];
	const result = syncLoopBoulderInhibition(state, () => {
		calls.push("resolve");
		return { kind: "resolved", inhibitBoulder: true };
	}, {
		get: () => { calls.push("get"); return { ok: true, snapshot: initial }; },
		set: (signal) => {
			calls.push("set");
			assert.deepEqual(signal, { type: "loop", value: true });
			return { ok: true, snapshot: written };
		},
	});
	assert.deepEqual(calls, ["resolve", "get", "set"]);
	assert.deepEqual(result, { ok: true, written: true, snapshot: written });
	if (!result.ok || !result.snapshot) assert.fail("expected success");
	assert.strictEqual(result.snapshot, written);
	assert.deepEqual(state, before);
	assert.deepEqual(initial, { states: [{ type: "user", value: true }], blockers: ["user"], inhibited: true });
});

test("sync client: matching loop values use only get and preserve the exact get snapshot", () => {
	for (const value of [true, false]) {
		const state: LoopInhibitionState = {
			tasks: [{ definition: { inhibitBoulder: value }, progress: { status: "active" } }], registrations: [],
		};
		const snapshot: BoulderInhibitionSnapshot = {
			states: [{ type: "loop", value }, { type: "user", value: true }],
			blockers: value ? ["loop", "user"] : ["user"], inhibited: true,
		};
		const calls: string[] = [];
		const client: BoulderInhibitionClient = {
			get: () => { calls.push("get"); return { ok: true, snapshot }; },
			set: () => { calls.push("set"); assert.fail("same value must not set"); },
		};
		for (let repeat = 0; repeat < 3; repeat++) {
			const result = syncLoopBoulderInhibition(state, () => { assert.fail("no registration"); }, client);
			assert.deepEqual(result, { ok: true, written: false, snapshot });
			if (!result.ok || !result.snapshot) assert.fail("expected success");
			assert.strictEqual(result.snapshot, snapshot);
		}
		assert.deepEqual(calls, ["get", "get", "get"]);
	}
});

test("sync client: missing loop still sets initial false after exactly one get", () => {
	const calls: string[] = [];
	const written: BoulderInhibitionSnapshot = { states: [{ type: "loop", value: false }], blockers: [], inhibited: false };
	const result = syncLoopBoulderInhibition({ tasks: [], registrations: [] }, () => { assert.fail("no registration"); }, {
		get: () => { calls.push("get"); return { ok: true, snapshot: { states: [], blockers: [], inhibited: false } }; },
		set: (signal) => { calls.push("set"); assert.deepEqual(signal, { type: "loop", value: false }); return { ok: true, snapshot: written }; },
	});
	assert.deepEqual(calls, ["get", "set"]);
	assert.deepEqual(result, { ok: true, written: true, snapshot: written });
	if (!result.ok || !result.snapshot) assert.fail("expected success");
	assert.strictEqual(result.snapshot, written);
});

for (const operation of ["get", "set"] as const) {
	test(`sync client: ${operation} failures are returned as results, never thrown, and stop later calls`, () => {
		const failures: BoulderInhibitionFailure[] = [
			{ message: "Boulder inhibition service unavailable" },
			{ message: "Boulder inhibition session unavailable" },
			{ message: "operation failed", cause: new Error("inner") },
			{ message: "raw cause", cause: { code: "failure" } },
		];
		for (const failure of failures) {
			const state: LoopInhibitionState = { tasks: [], registrations: [] };
			const calls: string[] = [];
			const result = syncLoopBoulderInhibition(state, () => { assert.fail("no registration"); }, {
				get: (): BoulderClientResult => {
					calls.push("get");
					if (operation === "get") return { ok: false, failure };
					return { ok: true, snapshot: { states: [], blockers: [], inhibited: false } };
				},
				set: (signal) => {
					calls.push("set");
					assert.deepEqual(signal, { type: "loop", value: false });
					return { ok: false, failure };
				},
			});
			assert.deepEqual(result, { ok: false, failure });
			if (result.ok) assert.fail("expected failure");
			assert.strictEqual(result.failure, failure);
			assert.deepEqual(calls, operation === "get" ? ["get"] : ["get", "set"]);
			assert.deepEqual(state, { tasks: [], registrations: [] });
		}
	});
}
