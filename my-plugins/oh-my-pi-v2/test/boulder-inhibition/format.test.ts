import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBoulderInhibition } from "../../boulder-inhibition/format-inhibition.ts";
import type { BoulderInhibitionSnapshot } from "../../boulder-inhibition/protocol.ts";

test("format: clear means only the signal gate, never started or eligible", () => {
	for (const states of [[], [{ type: "loop", value: false }]]) {
		const snapshot: BoulderInhibitionSnapshot = { states, blockers: [], inhibited: false };
		const before = structuredClone(snapshot);
		const text = formatBoulderInhibition(snapshot);
		assert.equal(text, "Boulder inhibition clear");
		assert.doesNotMatch(text, /started|eligible/i);
		assert.deepEqual(snapshot, before);
	}
});

test("format: all blockers appear in supplied order without altering the snapshot", () => {
	const snapshot: BoulderInhibitionSnapshot = {
		states: [
			{ type: "z", value: true }, { type: "off", value: false },
			{ type: "provider/name", value: true }, { type: "__proto__", value: true },
		],
		blockers: ["z", "provider/name", "__proto__"], inhibited: true,
	};
	const before = structuredClone(snapshot);
	for (const signal of snapshot.states) Object.freeze(signal);
	Object.freeze(snapshot.states);
	Object.freeze(snapshot.blockers);
	Object.freeze(snapshot);
	assert.equal(formatBoulderInhibition(snapshot), "Boulder inhibited: z, provider/name, __proto__");
	assert.deepEqual(snapshot, before);
});
