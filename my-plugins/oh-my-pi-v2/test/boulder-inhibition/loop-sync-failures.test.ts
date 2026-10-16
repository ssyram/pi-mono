import assert from "node:assert/strict";
import { test } from "node:test";
import { syncLoopBoulderInhibition, type LoopInhibitionState } from "../../boulder-inhibition/loop-inhibition.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { sessionBoundService } from "./session-bound-service.ts";

function registeredState(): LoopInhibitionState {
	return { tasks: [], registrations: [{
		id: "shared", reference: { scope: "workspace", definitionId: "definition" },
		registeredAt: 1, progress: { status: "active" },
	}] };
}

for (const failureKind of ["unavailable", "throw"] as const) {
	test(`sync: ${failureKind} aggregate returns a failure result without touching the service or logs`, () => {
		for (const entries of [[], [signalEntry("loop", true)], [signalEntry("loop", false)]]) {
			const branch = new InMemoryBranch(entries);
			const state = registeredState();
			const before = structuredClone(state);
			const failure = new Error("resolver failed");
			const service = sessionBoundService(branch, {
				cancelWait: () => { branch.events.push("cancelWait"); },
				reportInfo: () => { branch.events.push("reportInfo"); },
			});
			const result = syncLoopBoulderInhibition(state, () => {
				branch.events.push("resolve");
				if (failureKind === "throw") throw failure;
				return { kind: "unavailable" };
			}, service.client);
			assert.equal(result.ok, false);
			if (result.ok || !result.failure) assert.fail("expected failure");
			if (failureKind === "throw") {
				assert.equal(result.failure.message, "resolver failed");
				assert.ok(Object.is(result.failure.cause, failure));
			} else {
				assert.equal(result.failure.message, "Cannot resolve active loop registration: shared");
				assert.ok(result.failure.cause instanceof Error);
				assert.equal(result.failure.cause.message, "Cannot resolve active loop registration: shared");
			}
			assert.deepEqual(branch.events, ["resolve"]);
			assert.deepEqual(service.bus.emissions, []);
			assert.deepEqual(service.resolvedSessions, []);
			assert.deepEqual(branch.entries, entries);
			assert.deepEqual(state, before);
		}
	});
}

for (const point of ["initial-read", "append-before", "append-after", "write-read", "cancelWait", "reportInfo"] as const) {
	test(`sync: ${point} failure returns a failure result, preserves completed side effects, stops immediately`, () => {
		const branch = new InMemoryBranch([signalEntry("user", true)]);
		const failure = new Error(point);
		const state = registeredState();
		const before = structuredClone(state);
		let reads = 0;
		const getBranch = branch.getBranch.bind(branch);
		branch.getBranch = () => {
			reads++;
			const entries = getBranch();
			if ((point === "initial-read" && reads === 1) || (point === "write-read" && reads === 2)) throw failure;
			return entries;
		};
		const append = branch.appendEntry.bind(branch);
		branch.appendEntry = (customType, data) => {
			if (point === "append-before") {
				branch.events.push("appendEntry");
				throw failure;
			}
			append(customType, data);
			if (point === "append-after") throw failure;
		};
		const service = sessionBoundService(branch, {
			cancelWait: () => {
				branch.events.push("cancelWait");
				if (point === "cancelWait") throw failure;
			},
			reportInfo: (text) => {
				branch.events.push("reportInfo");
				assert.equal(text, "Boulder signal loop=true; Boulder inhibited: loop, user");
				if (point === "reportInfo") throw failure;
			},
		});
		const result = syncLoopBoulderInhibition(state, () => {
			branch.events.push("resolve");
			return { kind: "resolved", inhibitBoulder: true };
		}, service.client);
		assert.deepEqual(result, { ok: false, failure: { message: point, cause: failure } });
		assert.equal(service.bus.emissions.length, point === "initial-read" ? 1 : 2);
		const order = ["resolve", "getBranch", "appendEntry", "getBranch", "cancelWait", "reportInfo"];
		const lengths: Record<typeof point, number> = {
			"initial-read": 2, "append-before": 3, "append-after": 3,
			"write-read": 4, cancelWait: 5, reportInfo: 6,
		};
		assert.deepEqual(branch.events, order.slice(0, lengths[point]));
		const persisted = point !== "initial-read" && point !== "append-before";
		assert.deepEqual(branch.entries, persisted
			? [signalEntry("user", true), signalEntry("loop", true)] : [signalEntry("user", true)]);
		assert.deepEqual(state, before);
	});
}

test("sync: failure after append is not retried or repaired; a subsequent sync trusts the branch", () => {
	const branch = new InMemoryBranch();
	const failure = new Error("cancel failed after persistence");
	const state: LoopInhibitionState = {
		tasks: [{ definition: { inhibitBoulder: true }, progress: { status: "active" } }], registrations: [],
	};
	const resolve = (): never => { assert.fail("no registrations"); };
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); throw failure; },
		reportInfo: () => { branch.events.push("reportInfo"); },
	});
	assert.deepEqual(syncLoopBoulderInhibition(state, resolve, service.client), {
		ok: false, failure: { message: "cancel failed after persistence", cause: failure },
	});
	assert.deepEqual(branch.events, ["getBranch", "appendEntry", "getBranch", "cancelWait"]);
	assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
	branch.events.length = 0;
	assert.deepEqual(syncLoopBoulderInhibition(state, resolve, service.client), {
		ok: true, written: false, snapshot: { states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true },
	});
	assert.deepEqual(branch.events, ["getBranch"]);
	assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
});
