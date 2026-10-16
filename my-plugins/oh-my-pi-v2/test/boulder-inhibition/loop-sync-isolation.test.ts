import assert from "node:assert/strict";
import { test } from "node:test";
import { executeBoulderSetCommand } from "../../boulder-inhibition/command.ts";
import {
	syncLoopBoulderInhibition,
	type LoopInhibitionState,
	type LoopRegistrationResolution,
} from "../../boulder-inhibition/loop-inhibition.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { sessionBoundService } from "./session-bound-service.ts";

test("sync: manual loop=false is temporary and the next sync restores a live schedule", () => {
	const state: LoopInhibitionState = {
		tasks: [{ definition: { inhibitBoulder: true }, progress: { status: "active" } }], registrations: [],
	};
	const before = structuredClone(state);
	Object.freeze(state.tasks[0].definition);
	Object.freeze(state.tasks[0].progress);
	Object.freeze(state.tasks[0]);
	Object.freeze(state.tasks);
	Object.freeze(state.registrations);
	Object.freeze(state);
	const branch = new InMemoryBranch();
	const effects = {
		cancelWait: (): void => { branch.events.push("cancelWait"); },
		reportInfo: (text: string): void => { branch.events.push(`reportInfo:${text}`); },
	};
	const service = sessionBoundService(branch, effects);
	const resolve = (): never => { assert.fail("no registration"); };
	const firstSync = syncLoopBoulderInhibition(state, resolve, service.client);
	assert.equal(firstSync.ok && firstSync.written, true);
	const manual = executeBoulderSetCommand("boulder set loop f", service.client);
	assert.deepEqual(manual, {
		kind: "set", signal: { type: "loop", value: false },
		snapshot: { states: [{ type: "loop", value: false }], blockers: [], inhibited: false },
	});
	branch.events.length = 0;
	assert.deepEqual(syncLoopBoulderInhibition(state, resolve, service.client), {
		ok: true, written: true, snapshot: { states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true },
	});
	assert.deepEqual(branch.entries, [signalEntry("loop", true), signalEntry("loop", false), signalEntry("loop", true)]);
	assert.deepEqual(branch.events, [
		"getBranch", "appendEntry", "getBranch", "cancelWait", "reportInfo:Boulder signal loop=true; Boulder inhibited: loop",
	]);
	if (manual.kind !== "set") assert.fail("expected manual set");
	assert.equal(manual.snapshot.inhibited, false);
	assert.deepEqual(state, before);
});

test("sync: manual true with no schedule is reset; source case and other blockers are untouched", () => {
	const branch = new InMemoryBranch([signalEntry("Loop", true), signalEntry("__proto__", true)]);
	const effects = {
		cancelWait: (): void => { branch.events.push("cancelWait"); },
		reportInfo: (text: string): void => { branch.events.push(text); },
	};
	const service = sessionBoundService(branch, effects);
	executeBoulderSetCommand("boulder set loop t", service.client);
	branch.events.length = 0;
	assert.deepEqual(syncLoopBoulderInhibition({ tasks: [], registrations: [] }, () => {
		assert.fail("no registrations");
	}, service.client), {
		ok: true, written: true, snapshot: {
			states: [{ type: "loop", value: false }, { type: "__proto__", value: true }, { type: "Loop", value: true }],
			blockers: ["__proto__", "Loop"], inhibited: true,
		},
	});
	assert.deepEqual(branch.events, [
		"getBranch", "appendEntry", "getBranch", "cancelWait", "Boulder signal loop=false; Boulder inhibited: __proto__, Loop",
	]);
	assert.deepEqual(branch.entries, [
		signalEntry("Loop", true), signalEntry("__proto__", true), signalEntry("loop", true), signalEntry("loop", false),
	]);
});

test("sync: a case-distinct Loop source cannot replace the initial lowercase loop record", () => {
	const branch = new InMemoryBranch([signalEntry("Loop", true)]);
	const state: LoopInhibitionState = {
		tasks: [{ definition: { inhibitBoulder: true }, progress: { status: "active" } }], registrations: [],
	};
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(text); },
	});
	assert.deepEqual(syncLoopBoulderInhibition(state, () => { assert.fail("no registrations"); }, service.client), {
		ok: true, written: true, snapshot: {
			states: [{ type: "loop", value: true }, { type: "Loop", value: true }],
			blockers: ["loop", "Loop"], inhibited: true,
		},
	});
	assert.deepEqual(branch.entries, [signalEntry("Loop", true), signalEntry("loop", true)]);
	assert.deepEqual(branch.events, [
		"getBranch", "appendEntry", "getBranch", "cancelWait", "Boulder signal loop=true; Boulder inhibited: loop, Loop",
	]);
});

test("sync: branch switching, separate sessions, and returned mutations never supply cached state", () => {
	const state: LoopInhibitionState = {
		tasks: [{ definition: { inhibitBoulder: true }, progress: { status: "active" } }], registrations: [],
	};
	const port = new InMemoryBranch();
	const effects = { cancelWait() {}, reportInfo() {} };
	const service = sessionBoundService(port, effects);
	const resolve = (): never => { assert.fail("no registrations"); };
	const first = syncLoopBoulderInhibition(state, resolve, service.client);
	assert.equal(first.ok && first.written, true);
	const left = port.entries;
	port.entries = [];
	const second = syncLoopBoulderInhibition(state, resolve, service.client);
	assert.equal(second.ok && second.written, true);
	const right = port.entries;
	const otherSession = new InMemoryBranch();
	const otherService = sessionBoundService(otherSession, effects);
	assert.deepEqual(syncLoopBoulderInhibition({ tasks: [], registrations: [] }, resolve, otherService.client), {
		ok: true, written: true, snapshot: { states: [{ type: "loop", value: false }], blockers: [], inhibited: false },
	});
	if (!first.ok || !first.snapshot) assert.fail("expected success with snapshot");
	first.snapshot.states[0].value = false;
	first.snapshot.blockers.length = 0;
	port.entries = left;
	assert.deepEqual(syncLoopBoulderInhibition(state, resolve, service.client), {
		ok: true, written: false, snapshot: { states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true },
	});
	port.entries.push(signalEntry("loop", false));
	const last = syncLoopBoulderInhibition(state, resolve, service.client);
	assert.equal(last.ok && last.written, true);
	assert.deepEqual(left, [signalEntry("loop", true), signalEntry("loop", false), signalEntry("loop", true)]);
	assert.deepEqual(right, [signalEntry("loop", true)]);
	assert.deepEqual(otherSession.entries, [signalEntry("loop", false)]);
});

test("sync: re-resolves registrations before reading; confirmed missing closes, unchanged values stay silent", () => {
	const state: LoopInhibitionState = {
		tasks: [], registrations: [{
			id: "shared", reference: { scope: "global", definitionId: "definition" },
			registeredAt: 1, progress: { status: "active" },
		}],
	};
	const before = structuredClone(state);
	Object.freeze(state.registrations[0].reference);
	Object.freeze(state.registrations[0].progress);
	Object.freeze(state.registrations[0]);
	Object.freeze(state.registrations);
	Object.freeze(state.tasks);
	Object.freeze(state);
	const branch = new InMemoryBranch();
	let resolution: LoopRegistrationResolution = { kind: "resolved", inhibitBoulder: true };
	const resolver = (): LoopRegistrationResolution => { branch.events.push("resolve"); return resolution; };
	const effects = {
		cancelWait: (): void => { branch.events.push("cancelWait"); },
		reportInfo: (text: string): void => { branch.events.push(text); },
	};
	const service = sessionBoundService(branch, effects);
	const first = syncLoopBoulderInhibition(state, resolver, service.client);
	assert.equal(first.ok && first.written, true);
	assert.deepEqual(branch.events, [
		"resolve", "getBranch", "appendEntry", "getBranch", "cancelWait", "Boulder signal loop=true; Boulder inhibited: loop",
	]);
	branch.events.length = 0;
	const second = syncLoopBoulderInhibition(state, resolver, service.client);
	assert.equal(second.ok && second.written, false);
	assert.deepEqual(branch.events, ["resolve", "getBranch"]);
	resolution = { kind: "missing" };
	branch.events.length = 0;
	assert.deepEqual(syncLoopBoulderInhibition(state, resolver, service.client), {
		ok: true, written: true, snapshot: { states: [{ type: "loop", value: false }], blockers: [], inhibited: false },
	});
	assert.deepEqual(branch.events, [
		"resolve", "getBranch", "appendEntry", "getBranch", "Boulder signal loop=false; Boulder inhibition clear",
	]);
	assert.deepEqual(branch.entries, [signalEntry("loop", true), signalEntry("loop", false)]);
	assert.deepEqual(state, before);
	branch.events.length = 0;
	const idle = syncLoopBoulderInhibition({ tasks: [], registrations: [] }, resolver, service.client);
	assert.equal(idle.ok && idle.written, false);
	assert.deepEqual(branch.events, ["getBranch"]);
});
