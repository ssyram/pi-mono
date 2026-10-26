import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activeTaskCandidates,
	definitionCandidates,
	registrationCandidates,
	resolveTarget,
	scopeOfDefinitionId,
	sessionTaskCandidates,
	type TargetCandidate,
} from "../src/v2/resolve-target.js";
import type { LoopV2Core } from "../src/v2/loop-core.js";
import type {
	ActiveTask,
	Registration,
	SessionTask,
	SharedDefinition,
} from "../src/v2/model.js";

describe("resolveTarget", () => {
	it("resolves exact ids first, then unique names", () => {
		const candidates: TargetCandidate[] = [
			{ id: "session:one", name: "alpha" },
			{ id: "session:two", name: "beta" },
		];
		assert.deepEqual(resolveTarget("session:one", candidates), {
			ok: true,
			id: "session:one",
		});
		assert.deepEqual(resolveTarget("beta", candidates), {
			ok: true,
			id: "session:two",
		});
	});

	it("rejects ambiguous names listing every match and reports missing targets", () => {
		const candidates: TargetCandidate[] = [
			{ id: "session:one", name: "dup" },
			{ id: "session:two", name: "dup" },
		];
		const ambiguous = resolveTarget("dup", candidates);
		assert.equal(ambiguous.ok, false);
		if (ambiguous.ok) return;
		assert.match(ambiguous.message, /ambiguous name "dup" matches/);
		assert.match(ambiguous.message, /session:one/);
		assert.match(ambiguous.message, /session:two/);
		const missing = resolveTarget("gamma", candidates);
		assert.equal(missing.ok, false);
		if (missing.ok) return;
		assert.match(missing.message, /no match for "gamma"/);
	});

	it("an exact id never resolves through a name that collides with another candidate", () => {
		const candidates: TargetCandidate[] = [
			{ id: "session:one" },
			{ id: "session:two", name: "session:one" },
		];
		assert.deepEqual(resolveTarget("session:one", candidates), {
			ok: true,
			id: "session:one",
		});
	});
});

describe("candidate extraction", () => {
	it("maps active tasks, registrations, definitions, and session tasks", () => {
		const core = fakeCore();
		assert.deepEqual(activeTaskCandidates(core), [
			{ id: "session:task", name: "alpha" },
			{ id: "registration:workspace:def", name: "shared name" },
		]);
		assert.deepEqual(registrationCandidates(core), [
			{ id: "registration:workspace:def", name: "shared name" },
		]);
		assert.deepEqual(definitionCandidates(core), [
			{ id: "workspace:def", name: "shared name" },
		]);
		assert.deepEqual(sessionTaskCandidates(core), [
			{ id: "session:task", name: "alpha" },
			{ id: "session:done" },
		]);
		assert.equal(scopeOfDefinitionId("workspace:def"), "workspace");
		assert.equal(scopeOfDefinitionId("global:def"), "global");
		assert.equal(scopeOfDefinitionId("session:def"), undefined);
	});
});

function fakeCore(): LoopV2Core {
	const sessionTask: SessionTask = {
		definition: {
			id: "session:task",
			scope: "session",
			prompt: "p",
			schedule: { kind: "interval", intervalMs: 1000 },
			createdAt: 1,
			name: "alpha",
		},
		progress: { status: "active", nextRunAt: 10, runCount: 0 },
	};
	const doneTask: SessionTask = {
		definition: {
			id: "session:done",
			scope: "session",
			prompt: "p",
			schedule: { kind: "once", runAt: 10 },
			createdAt: 1,
		},
		progress: { status: "completed", runCount: 1, lastRunAt: 20 },
	};
	const registration: Registration = {
		id: "registration:workspace:def",
		reference: { scope: "workspace", definitionId: "workspace:def" },
		progress: { status: "active", nextRunAt: 10, runCount: 0 },
		registeredAt: 1,
	};
	const definition: SharedDefinition = {
		id: "workspace:def",
		scope: "workspace",
		prompt: "p",
		schedule: { kind: "interval", intervalMs: 1000 },
		createdAt: 1,
		name: "shared name",
	};
	const registrationActive: ActiveTask = {
		kind: "registration",
		registration,
		definition,
	};
	return {
		listActive: () => [
			{ kind: "session", task: sessionTask },
			registrationActive,
		],
		listDefinitions: () => [definition],
		snapshotSessionState: () => ({
			version: 1,
			tasks: [sessionTask, doneTask],
			registrations: [registration],
		}),
	} as unknown as LoopV2Core;
}
