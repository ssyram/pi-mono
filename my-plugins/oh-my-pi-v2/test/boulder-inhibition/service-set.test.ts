import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoulderInhibitionServiceResponse } from "../../boulder-inhibition/service-protocol.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { sessionBoundService } from "./session-bound-service.ts";

test("service set: decode, append, read, cancel, report, reply all finish before emit returns", () => {
	const branch = new InMemoryBranch([signalEntry("user", true)]);
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(text); },
	});
	const signal = Object.freeze({ type: "loop", value: true, ignored: "not stored" });
	const replies: BoulderInhibitionServiceResponse[] = [];
	service.bus.emit("omp:boulder:inhibition:v1", {
		session: service.session, op: "set", signal,
		reply: (result: BoulderInhibitionServiceResponse) => { branch.events.push("reply"); replies.push(result); },
	});
	branch.events.push("emit-return");
	assert.deepEqual(branch.events, [
		"appendEntry", "getBranch", "cancelWait", "Boulder signal loop=true; Boulder inhibited: loop, user", "reply", "emit-return",
	]);
	assert.deepEqual(replies, [{ ok: true, snapshot: {
		states: [{ type: "loop", value: true }, { type: "user", value: true }], blockers: ["loop", "user"], inhibited: true,
	} }]);
	assert.deepEqual(branch.entries, [signalEntry("user", true), signalEntry("loop", true)]);
	assert.notStrictEqual(branch.entries[1].data, signal);
	assert.deepEqual(signal, { type: "loop", value: true, ignored: "not stored" });
	assert.equal(service.resolvedSessions.length, 1);
	assert.strictEqual(service.resolvedSessions[0], service.session);
	assert.deepEqual(service.bus.handlerErrors, []);
});

test("service set: repeated values write each time and false still cancels for a sibling blocker", () => {
	const branch = new InMemoryBranch([signalEntry("user", true)]);
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(text); },
	});
	for (const value of [true, true, false, false]) {
		const result = service.client.set({ type: "loop", value });
		assert.deepEqual(result, { ok: true, snapshot: {
			states: [{ type: "loop", value }, { type: "user", value: true }],
			blockers: value ? ["loop", "user"] : ["user"], inhibited: true,
		} });
	}
	assert.deepEqual(branch.entries, [
		signalEntry("user", true), signalEntry("loop", true), signalEntry("loop", true),
		signalEntry("loop", false), signalEntry("loop", false),
	]);
	assert.deepEqual(branch.events, [true, true, false, false].flatMap((value) => [
		"appendEntry", "getBranch", "cancelWait",
		`Boulder signal loop=${value}; Boulder inhibited: ${value ? "loop, user" : "user"}`,
	]));
	assert.equal(service.resolvedSessions.length, 4);
	assert.equal(service.bus.emissions.length, 4);
	assert.deepEqual(service.bus.handlerErrors, []);
});

test("service set: closing the last source stays clear and snapshots cannot rewrite persisted records", () => {
	const branch = new InMemoryBranch([signalEntry("loop", true)]);
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(text); },
	});
	const signal = { type: "loop", value: false };
	const setResult = service.client.set(signal);
	assert.equal(setResult.ok, true);
	if (!setResult.ok) assert.fail("expected success");
	const snapshot = setResult.snapshot;
	const blockers = snapshot.blockers;
	assert.deepEqual(snapshot, { states: [{ type: "loop", value: false }], blockers: [], inhibited: false });
	assert.deepEqual(branch.events, ["appendEntry", "getBranch", "Boulder signal loop=false; Boulder inhibition clear"]);
	signal.type = "changed";
	signal.value = true;
	snapshot.states[0].value = true;
	blockers.push("loop");
	assert.deepEqual(branch.entries, [signalEntry("loop", true), signalEntry("loop", false)]);
	const finalGet = service.client.get();
	assert.deepEqual(finalGet, { ok: true, snapshot: { states: [{ type: "loop", value: false }], blockers: [], inhibited: false } });
	assert.deepEqual(branch.events, [
		"appendEntry", "getBranch", "Boulder signal loop=false; Boulder inhibition clear", "getBranch",
	]);
});
