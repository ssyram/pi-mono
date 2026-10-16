import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoulderEntryLike, BoulderInhibitionSnapshot } from "../../boulder-inhibition/protocol.ts";
import { readBoulderInhibition } from "../../boulder-inhibition/read-inhibition.ts";

function forwardReference(entries: readonly BoulderEntryLike[]): BoulderInhibitionSnapshot {
	const latest = new Map<string, { position: number; type: string; value: boolean }>();
	for (let position = 0; position < entries.length; position++) {
		const entry = entries[position];
		if (entry.type !== "custom" || entry.customType !== "OMPv2InhibitBoulder") continue;
		const data = entry.data;
		if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
		if (!("type" in data) || !("value" in data)) continue;
		if (typeof data.type !== "string" || data.type.length === 0 || /\s/u.test(data.type)) continue;
		if (typeof data.value !== "boolean") continue;
		latest.set(data.type, { position, type: data.type, value: data.value });
	}
	const states = [...latest.values()].sort((a, b) => b.position - a.position)
		.map(({ type, value }) => ({ type, value }));
	const blockers = states.filter((signal) => signal.value).map((signal) => signal.type);
	return { states, blockers, inhibited: blockers.length > 0 };
}

test("read: fixed-seed sequences and every prefix match a forward last-write model", () => {
	const seed = 0x6a57a202;
	let random = seed;
	const next = (): number => {
		random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
		return random;
	};
	const types = ["loop", "user", "Loop", "__proto__", "constructor", "toString", "provider/name", "来源", "0"];
	for (let trial = 0; trial < 128; trial++) {
		const branch: BoulderEntryLike[] = [];
		const length = next() % 97;
		assert.deepEqual(readBoulderInhibition(branch), forwardReference(branch));
		for (let position = 0; position < length; position++) {
			const type = types[next() % types.length];
			const value = next() >= 0x80000000;
			const category = next() % 13;
			let entry: BoulderEntryLike;
			switch (category) {
				case 0: entry = { type: "message", customType: "OMPv2InhibitBoulder", data: { type, value } }; break;
				case 1: entry = { type: "custom", customType: "other", data: { type, value } }; break;
				case 2: entry = { type: "custom", customType: "OMPv2InhibitBoulder", data: null }; break;
				case 3: entry = { type: "custom", customType: "OMPv2InhibitBoulder", data: [{ type, value }] }; break;
				case 4: entry = { type: "custom", customType: "OMPv2InhibitBoulder", data: { type: `${type}\t`, value } }; break;
				case 5: entry = { type: "custom", customType: "OMPv2InhibitBoulder", data: { type, value: String(value) } }; break;
				case 6: entry = { type: "custom", customType: "OMPv2InhibitBoulder", data: { type: "", value } }; break;
				default: entry = {
					type: "custom", customType: "OMPv2InhibitBoulder",
					data: { type, value, timestamp: next(), extra: { ignored: true } },
				};
			}
			branch.push(entry);
			const before = structuredClone(branch);
			const actual = readBoulderInhibition(branch);
			assert.deepEqual(actual, forwardReference(branch), `seed=${seed} trial=${trial} prefix=${position + 1}`);
			assert.deepEqual(branch, before);
			assert.equal(new Set(actual.states.map((signal) => signal.type)).size, actual.states.length);
			assert.deepEqual(actual.blockers, actual.states.filter((signal) => signal.value).map((signal) => signal.type));
			assert.equal(actual.inhibited, actual.blockers.length !== 0);
		}
	}
});
