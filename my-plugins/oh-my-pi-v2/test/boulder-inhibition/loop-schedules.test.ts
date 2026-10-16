import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSpecialLoopSchedules, type LoopInhibitionState } from "../../boulder-inhibition/loop-inhibition.ts";

test("loop: session tasks require both active status and an explicit true flag", () => {
	for (const status of ["active", "completed", "expired"] as const) {
		for (const definition of [{}, { inhibitBoulder: false }, { inhibitBoulder: true }]) {
			const state: LoopInhibitionState = { tasks: [{ definition, progress: { status } }], registrations: [] };
			const before = structuredClone(state);
			let resolutions = 0;
			assert.equal(hasSpecialLoopSchedules(state, () => {
				resolutions++;
				return { kind: "unavailable" };
			}), status === "active" && definition.inhibitBoulder === true);
			assert.equal(resolutions, 0);
			assert.deepEqual(state, before);
		}
	}
});

test("loop: empty state and unregistered shared definitions do not participate", () => {
	const catalog = new Map([["unregistered-special", true]]);
	let resolutions = 0;
	assert.equal(hasSpecialLoopSchedules({ tasks: [], registrations: [] }, (registration) => {
		resolutions++;
		return { kind: "resolved", inhibitBoulder: catalog.get(registration.reference.definitionId) === true };
	}), false);
	assert.equal(resolutions, 0);
});

test("loop: the aggregate is existential, not a count or the last task's value", () => {
	const special = { definition: { inhibitBoulder: true }, progress: { status: "active" as const } };
	const ordinary = { definition: {}, progress: { status: "active" as const } };
	const completed = { definition: { inhibitBoulder: true }, progress: { status: "completed" as const } };
	const cases = [
		{ tasks: [special, ordinary], expected: true },
		{ tasks: [ordinary, special], expected: true },
		{ tasks: [completed, ordinary, special], expected: true },
		{ tasks: [special, special], expected: true },
		{ tasks: [special], expected: true },
		{ tasks: [ordinary, completed], expected: false },
		{ tasks: [], expected: false },
	];
	for (const { tasks, expected } of cases) {
		assert.equal(hasSpecialLoopSchedules({ tasks, registrations: [] }, () => {
			assert.fail("no registration should be resolved");
		}), expected);
	}
});

test("loop: active special task remains inhibiting across repeated reads without a wakeup", () => {
	const state: LoopInhibitionState = {
		tasks: [{ definition: { inhibitBoulder: true }, progress: { status: "active" } }], registrations: [],
	};
	Object.freeze(state.tasks[0].definition);
	Object.freeze(state.tasks[0].progress);
	Object.freeze(state.tasks[0]);
	Object.freeze(state.tasks);
	Object.freeze(state.registrations);
	Object.freeze(state);
	for (let repeat = 0; repeat < 4; repeat++) {
		assert.equal(hasSpecialLoopSchedules(state, () => { assert.fail("no registration"); }), true);
	}
});

test("loop: a proven session task short-circuits all registrations, even unavailable ones", () => {
	const state: LoopInhibitionState = {
		tasks: [
			{ definition: {}, progress: { status: "active" } },
			{ definition: { inhibitBoulder: true }, progress: { status: "active" } },
		],
		registrations: [{
			id: "unavailable", reference: { scope: "global", definitionId: "shared" },
			registeredAt: 0, progress: { status: "active" },
		}],
	};
	let resolutions = 0;
	assert.equal(hasSpecialLoopSchedules(state, () => { resolutions++; return { kind: "unavailable" }; }), true);
	assert.equal(resolutions, 0);
});
