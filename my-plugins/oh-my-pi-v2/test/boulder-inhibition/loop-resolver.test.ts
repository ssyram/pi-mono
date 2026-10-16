import assert from "node:assert/strict";
import { test } from "node:test";
import {
	hasSpecialLoopSchedules,
	type LoopInhibitionRegistration,
	type LoopInhibitionState,
	type LoopRegistrationResolution,
} from "../../boulder-inhibition/loop-inhibition.ts";

function registration(id: string, status: "active" | "completed" | "expired" = "active"): LoopInhibitionRegistration {
	return { id, reference: { scope: "workspace", definitionId: `definition/${id}` }, registeredAt: 1, progress: { status } };
}

test("loop: active shared resolutions distinguish special, ordinary, missing and unavailable", () => {
	const resolutions: LoopRegistrationResolution[] = [
		{ kind: "resolved", inhibitBoulder: true }, { kind: "resolved", inhibitBoulder: false }, { kind: "missing" },
	];
	for (const scope of ["workspace", "global"] as const) {
		for (const resolution of resolutions) {
			const item = registration("shared");
			item.reference.scope = scope;
			const state: LoopInhibitionState = { tasks: [], registrations: [item] };
			const before = structuredClone(state);
			const calls: LoopInhibitionRegistration[] = [];
			assert.equal(hasSpecialLoopSchedules(state, (received) => {
				calls.push(received);
				return resolution;
			}), resolution.kind === "resolved" && resolution.inhibitBoulder);
			assert.deepEqual(calls, [item]);
			assert.strictEqual(calls[0], item);
			assert.deepEqual(state, before);
		}
	}
});

test("loop: inactive registrations are skipped even if resolution would fail", () => {
	const state: LoopInhibitionState = {
		tasks: [], registrations: [registration("completed", "completed"), registration("expired", "expired")],
	};
	let calls = 0;
	assert.equal(hasSpecialLoopSchedules(state, () => { calls++; throw new Error("must not resolve"); }), false);
	assert.equal(calls, 0);
});

test("loop: non-special session tasks do not prevent a shared registration from witnessing true", () => {
	const state: LoopInhibitionState = {
		tasks: [
			{ definition: {}, progress: { status: "active" } },
			{ definition: { inhibitBoulder: false }, progress: { status: "active" } },
			{ definition: { inhibitBoulder: true }, progress: { status: "completed" } },
			{ definition: { inhibitBoulder: true }, progress: { status: "expired" } },
		],
		registrations: [registration("special")],
	};
	const before = structuredClone(state);
	const calls: string[] = [];
	assert.equal(hasSpecialLoopSchedules(state, (item) => {
		calls.push(item.id);
		return { kind: "resolved", inhibitBoulder: true };
	}), true);
	assert.deepEqual(calls, ["special"]);
	assert.deepEqual(state, before);
});

test("loop: missing and ordinary registrations are skipped until a later true witness", () => {
	const registrations = [
		registration("inactive", "completed"), registration("missing"), registration("ordinary"),
		registration("special"), registration("unavailable"),
	];
	const calls: string[] = [];
	assert.equal(hasSpecialLoopSchedules({ tasks: [], registrations }, (item) => {
		calls.push(item.id);
		if (item.id === "missing") return { kind: "missing" };
		if (item.id === "ordinary") return { kind: "resolved", inhibitBoulder: false };
		if (item.id === "special") return { kind: "resolved", inhibitBoulder: true };
		return { kind: "unavailable" };
	}), true);
	assert.deepEqual(calls, ["missing", "ordinary", "special"]);
});

test("loop: false requires exhausting all participating registrations", () => {
	const registrations = [registration("missing"), registration("ordinary"), registration("last")];
	const calls: string[] = [];
	assert.equal(hasSpecialLoopSchedules({ tasks: [], registrations }, (item) => {
		calls.push(item.id);
		return item.id === "ordinary" ? { kind: "resolved", inhibitBoulder: false } : { kind: "missing" };
	}), false);
	assert.deepEqual(calls, ["missing", "ordinary", "last"]);
});

test("loop: unavailable before a later witness throws the exact message without looking ahead", () => {
	const registrations = [registration("ordinary"), registration("unknown/id"), registration("special")];
	const calls: string[] = [];
	assert.throws(() => hasSpecialLoopSchedules({ tasks: [], registrations }, (item) => {
		calls.push(item.id);
		if (item.id === "ordinary") return { kind: "resolved", inhibitBoulder: false };
		if (item.id === "special") return { kind: "resolved", inhibitBoulder: true };
		return { kind: "unavailable" };
	}), (error: unknown) => error instanceof Error && error.message === "Cannot resolve active loop registration: unknown/id");
	assert.deepEqual(calls, ["ordinary", "unknown/id"]);
});

test("loop: an earlier registration witness short-circuits a later unavailable registration", () => {
	const calls: string[] = [];
	assert.equal(hasSpecialLoopSchedules({ tasks: [], registrations: [registration("special"), registration("unknown")] }, (item) => {
		calls.push(item.id);
		return item.id === "special" ? { kind: "resolved", inhibitBoulder: true } : { kind: "unavailable" };
	}), true);
	assert.deepEqual(calls, ["special"]);
});

test("loop: resolver exceptions propagate unchanged and stop subsequent resolution", () => {
	const failure = new Error("catalog unavailable");
	const calls: string[] = [];
	assert.throws(() => hasSpecialLoopSchedules({ tasks: [], registrations: [registration("bad"), registration("later")] }, (item) => {
		calls.push(item.id);
		throw failure;
	}), (error: unknown) => error === failure);
	assert.deepEqual(calls, ["bad"]);
});

test("loop: resolution reads frozen caller-owned registration data without modification", () => {
	const item = registration("frozen");
	Object.freeze(item.reference);
	Object.freeze(item.progress);
	Object.freeze(item);
	const state = Object.freeze({ tasks: Object.freeze([]), registrations: Object.freeze([item]) });
	const before = structuredClone(state);
	assert.equal(hasSpecialLoopSchedules(state, (received) => {
		assert.strictEqual(received, item);
		return { kind: "resolved", inhibitBoulder: true };
	}), true);
	assert.deepEqual(state, before);
});
