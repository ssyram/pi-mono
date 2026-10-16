import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoulderEntryLike } from "../../boulder-inhibition/protocol.ts";
import { readBoulderInhibition } from "../../boulder-inhibition/read-inhibition.ts";
import { signalEntry } from "./in-memory-branch.ts";

const malformedData: readonly unknown[] = [
	undefined, null, false, true, 0, 1, "loop", Symbol("loop"), 1n, () => false,
	[], [{ type: "loop", value: false }],
	Object.assign([], { type: "loop", value: false }),
	{}, { type: "loop" }, { value: false },
	{ type: "", value: false }, { type: null, value: false },
	{ type: 1, value: false }, { type: ["loop"], value: false },
	{ type: new String("loop"), value: false },
	{ type: "loop", value: "false" }, { type: "loop", value: "true" },
	{ type: "loop", value: 0 }, { type: "loop", value: 1 },
	{ type: "loop", value: null }, { type: "loop", value: undefined },
	{ type: "loop", value: new Boolean(false) },
	...[" ", "\t", "\r", "\n", "\v", "\f", "\u00a0", "\u2003", "\u2028", "\u2029", "\ufeff"]
		.flatMap((space) => [
			{ type: `${space}loop`, value: false },
			{ type: `lo${space}op`, value: false },
			{ type: `loop${space}`, value: false },
		]),
];

test("read: malformed data is ignored and cannot mask an older valid value", () => {
	for (const [index, data] of malformedData.entries()) {
		const malformed: BoulderEntryLike = { type: "custom", customType: "OMPv2InhibitBoulder", data };
		assert.deepEqual(readBoulderInhibition([malformed]), {
			states: [], blockers: [], inhibited: false,
		}, `malformed data ${index} must not create a source`);
		assert.deepEqual(readBoulderInhibition([signalEntry("loop", true), malformed]), {
			states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true,
		}, `malformed data ${index} must not hide valid history`);
	}
});

test("read: non-custom entries, custom messages, and other custom types never participate", () => {
	const ignored: BoulderEntryLike[] = [
		{ type: "message", customType: "OMPv2InhibitBoulder", data: { type: "loop", value: false } },
		{ type: "custom_message", customType: "OMPv2InhibitBoulder", data: { type: "loop", value: false } },
		{ type: "Custom", customType: "OMPv2InhibitBoulder", data: { type: "loop", value: false } },
		{ type: "custom", data: { type: "loop", value: false } },
		{ type: "custom", customType: "other", data: { type: "loop", value: false } },
		{ type: "custom", customType: "ompv2inhibitboulder", data: { type: "loop", value: false } },
		{ type: "custom", customType: "OMPv2InhibitBoulder ", data: { type: "loop", value: false } },
	];
	assert.deepEqual(readBoulderInhibition(ignored), { states: [], blockers: [], inhibited: false });
	assert.deepEqual(readBoulderInhibition([signalEntry("loop", true), ...ignored]), {
		states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true,
	});
});

test("read: extra data fields are ignored and never exposed in states", () => {
	const data = { type: "loop", value: false, timestamp: 42, author: "manual", nested: { value: true } };
	assert.deepEqual(readBoulderInhibition([
		signalEntry("loop", true),
		{ type: "custom", customType: "OMPv2InhibitBoulder", data },
	]), {
		states: [{ type: "loop", value: false }], blockers: [], inhibited: false,
	});
});

test("read: malformed newest value preserves a valid false and its source position", () => {
	assert.deepEqual(readBoulderInhibition([
		signalEntry("loop", true), signalEntry("loop", false), signalEntry("user", true),
		{ type: "custom", customType: "OMPv2InhibitBoulder", data: { type: "loop", value: "true" } },
	]), {
		states: [{ type: "user", value: true }, { type: "loop", value: false }],
		blockers: ["user"], inhibited: true,
	});
});
