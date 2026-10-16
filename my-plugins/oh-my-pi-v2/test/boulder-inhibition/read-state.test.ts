import assert from "node:assert/strict";
import { test } from "node:test";
import { BOULDER_INHIBIT_ENTRY_TYPE } from "../../boulder-inhibition/protocol.ts";
import { readBoulderInhibition } from "../../boulder-inhibition/read-inhibition.ts";
import { signalEntry } from "./in-memory-branch.ts";

test("protocol: the stored custom type is fixed", () => {
	assert.equal(BOULDER_INHIBIT_ENTRY_TYPE, "OMPv2InhibitBoulder");
});

test("read: empty branch and single true/false signals", () => {
	assert.deepEqual(readBoulderInhibition([]), { states: [], blockers: [], inhibited: false });
	for (const value of [true, false]) {
		assert.deepEqual(readBoulderInhibition([signalEntry("loop", value)]), {
			states: [{ type: "loop", value }],
			blockers: value ? ["loop"] : [],
			inhibited: value,
		});
	}
});

test("read: latest false consumes its type; later true reactivates only that type", () => {
	const entries = [signalEntry("loop", true), signalEntry("user", true), signalEntry("loop", false)];
	assert.deepEqual(readBoulderInhibition(entries), {
		states: [{ type: "loop", value: false }, { type: "user", value: true }],
		blockers: ["user"],
		inhibited: true,
	});
	entries.push(signalEntry("loop", true));
	assert.deepEqual(readBoulderInhibition(entries), {
		states: [{ type: "loop", value: true }, { type: "user", value: true }],
		blockers: ["loop", "user"],
		inhibited: true,
	});
});

test("read: all blockers follow newest valid source order without sorting", () => {
	assert.deepEqual(readBoulderInhibition([
		signalEntry("a", true), signalEntry("z", false), signalEntry("m", true),
		signalEntry("z", true), signalEntry("off", false), signalEntry("a", true),
	]), {
		states: [
			{ type: "a", value: true }, { type: "off", value: false },
			{ type: "z", value: true }, { type: "m", value: true },
		],
		blockers: ["a", "z", "m"],
		inhibited: true,
	});
});

test("read: case-sensitive sources and ordinary Map-like keys stay independent", () => {
	const types = ["loop", "Loop", "LOOP", "__proto__", "constructor", "toString", "provider/name", "来源"];
	const entries = types.map((type) => signalEntry(type, true));
	entries.push(signalEntry("loop", false), signalEntry("__proto__", false));
	assert.deepEqual(readBoulderInhibition(entries), {
		states: [
			{ type: "__proto__", value: false }, { type: "loop", value: false },
			...types.slice(1).filter((type) => type !== "__proto__").reverse()
				.map((type) => ({ type, value: true })),
		],
		blockers: ["来源", "provider/name", "toString", "constructor", "LOOP", "Loop"],
		inhibited: true,
	});
});

test("read: array position wins over timestamps and author metadata", () => {
	const entries = [
		{ ...signalEntry("loop", true), timestamp: "2099-01-01", author: "plugin" },
		{ ...signalEntry("user", true), timestamp: "1990-01-01", author: "manual" },
		{ ...signalEntry("loop", false), timestamp: "1980-01-01", author: "manual" },
	];
	assert.deepEqual(readBoulderInhibition(entries), {
		states: [{ type: "loop", value: false }, { type: "user", value: true }],
		blockers: ["user"],
		inhibited: true,
	});
});
