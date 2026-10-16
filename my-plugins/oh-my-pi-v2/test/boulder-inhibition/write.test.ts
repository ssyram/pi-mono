import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoulderInhibitionEffects } from "../../boulder-inhibition/protocol.ts";
import { writeBoulderInhibition } from "../../boulder-inhibition/write-inhibition.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";

test("write: copies signal, appends the protocol entry, then reads, cancels and reports", () => {
	const branch = new InMemoryBranch([signalEntry("user", true)]);
	const signal = Object.freeze({ type: "loop", value: true });
	const effects: BoulderInhibitionEffects = {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(`reportInfo:${text}`); },
	};
	const snapshot = writeBoulderInhibition(branch, effects, signal);
	assert.deepEqual(branch.events, [
		"appendEntry", "getBranch", "cancelWait",
		"reportInfo:Boulder signal loop=true; Boulder inhibited: loop, user",
	]);
	assert.deepEqual(branch.entries, [signalEntry("user", true), signalEntry("loop", true)]);
	assert.notStrictEqual(branch.entries[1].data, signal);
	assert.notStrictEqual(snapshot.states[0], branch.entries[1].data);
	assert.deepEqual(signal, { type: "loop", value: true });
	assert.deepEqual(snapshot, {
		states: [{ type: "loop", value: true }, { type: "user", value: true }],
		blockers: ["loop", "user"], inhibited: true,
	});
});

test("write: repeated values always append and report, even when already clear", () => {
	const branch = new InMemoryBranch();
	const effects: BoulderInhibitionEffects = {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(`reportInfo:${text}`); },
	};
	for (let repeat = 0; repeat < 2; repeat++) {
		assert.deepEqual(writeBoulderInhibition(branch, effects, { type: "loop", value: false }), {
			states: [{ type: "loop", value: false }], blockers: [], inhibited: false,
		});
	}
	assert.deepEqual(branch.entries, [signalEntry("loop", false), signalEntry("loop", false)]);
	assert.deepEqual(branch.events, [
		"appendEntry", "getBranch", "reportInfo:Boulder signal loop=false; Boulder inhibition clear",
		"appendEntry", "getBranch", "reportInfo:Boulder signal loop=false; Boulder inhibition clear",
	]);
});

test("write: repeated true writes each cancel exactly once and report exactly once", () => {
	const branch = new InMemoryBranch();
	const effects: BoulderInhibitionEffects = {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(`reportInfo:${text}`); },
	};
	for (let repeat = 0; repeat < 2; repeat++) {
		writeBoulderInhibition(branch, effects, { type: "loop", value: true });
	}
	assert.equal(branch.entries.length, 2);
	assert.deepEqual(branch.events, Array.from({ length: 2 }, () => [
		"appendEntry", "getBranch", "cancelWait", "reportInfo:Boulder signal loop=true; Boulder inhibited: loop",
	]).flat());
});

test("write: false still cancels when another source blocks; clearing the last source does not", () => {
	const branch = new InMemoryBranch([signalEntry("loop", true), signalEntry("user", true)]);
	const effects: BoulderInhibitionEffects = {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(`reportInfo:${text}`); },
	};
	assert.deepEqual(writeBoulderInhibition(branch, effects, { type: "loop", value: false }), {
		states: [{ type: "loop", value: false }, { type: "user", value: true }],
		blockers: ["user"], inhibited: true,
	});
	assert.deepEqual(writeBoulderInhibition(branch, effects, { type: "user", value: false }), {
		states: [{ type: "user", value: false }, { type: "loop", value: false }],
		blockers: [], inhibited: false,
	});
	assert.deepEqual(branch.events, [
		"appendEntry", "getBranch", "cancelWait", "reportInfo:Boulder signal loop=false; Boulder inhibited: user",
		"appendEntry", "getBranch", "reportInfo:Boulder signal user=false; Boulder inhibition clear",
	]);
});

test("write: caller mutation after append cannot rewrite the stored signal", () => {
	const branch = new InMemoryBranch();
	const signal = { type: "provider/name", value: true };
	const snapshot = writeBoulderInhibition(branch, { cancelWait() {}, reportInfo() {} }, signal);
	signal.type = "changed";
	signal.value = false;
	snapshot.states[0].value = false;
	assert.deepEqual(branch.entries, [signalEntry("provider/name", true)]);
});
