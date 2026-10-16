import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoulderInhibition } from "../../boulder-inhibition/read-inhibition.ts";
import { signalEntry } from "./in-memory-branch.ts";

test("read: accepts frozen input without mutation and returns detached signal objects", () => {
	const data = Object.freeze({ type: "loop", value: true });
	const entry = Object.freeze({ type: "custom", customType: "OMPv2InhibitBoulder", data });
	const branch = Object.freeze([entry]);
	const snapshot = readBoulderInhibition(branch);
	assert.deepEqual(snapshot, {
		states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true,
	});
	assert.notStrictEqual(snapshot.states[0], data);
	assert.deepEqual(branch, [{ type: "custom", customType: "OMPv2InhibitBoulder", data: { type: "loop", value: true } }]);
});

test("read: modifying a result cannot change input or a subsequent result", () => {
	const branch = [signalEntry("loop", true), signalEntry("user", false)];
	const first = readBoulderInhibition(branch);
	const second = readBoulderInhibition(branch);
	assert.notStrictEqual(first, second);
	assert.notStrictEqual(first.states, second.states);
	assert.notStrictEqual(first.blockers, second.blockers);
	for (let index = 0; index < first.states.length; index++) {
		assert.notStrictEqual(first.states[index], second.states[index]);
	}
	first.states[0].type = "corrupt";
	first.states[0].value = true;
	first.states.push({ type: "injected", value: true });
	first.blockers.push("injected");
	first.inhibited = false;
	const expected = {
		states: [{ type: "user", value: false }, { type: "loop", value: true }],
		blockers: ["loop"], inhibited: true,
	};
	assert.deepEqual(second, expected);
	assert.deepEqual(readBoulderInhibition(branch), expected);
	assert.deepEqual(branch, [signalEntry("loop", true), signalEntry("user", false)]);
});

test("read: input changes after return cannot mutate an earlier snapshot", () => {
	const data = { type: "loop", value: true };
	const entries = [{ type: "custom", customType: "OMPv2InhibitBoulder", data }];
	const snapshot = readBoulderInhibition(entries);
	data.type = "user";
	data.value = false;
	assert.deepEqual(snapshot, {
		states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true,
	});
	assert.deepEqual(readBoulderInhibition(entries), {
		states: [{ type: "user", value: false }], blockers: [], inhibited: false,
	});
});

test("read: interleaved branches sharing ancestry never contaminate each other", () => {
	const root = signalEntry("loop", true);
	const left = [root, signalEntry("loop", false), signalEntry("left", true)];
	const right = [root, signalEntry("right", true)];
	const expectedLeft = {
		states: [{ type: "left", value: true }, { type: "loop", value: false }],
		blockers: ["left"], inhibited: true,
	};
	const expectedRight = {
		states: [{ type: "right", value: true }, { type: "loop", value: true }],
		blockers: ["right", "loop"], inhibited: true,
	};
	for (let repeat = 0; repeat < 3; repeat++) {
		assert.deepEqual(readBoulderInhibition(left), expectedLeft);
		assert.deepEqual(readBoulderInhibition(right), expectedRight);
		assert.deepEqual(readBoulderInhibition([]), { states: [], blockers: [], inhibited: false });
	}
});
