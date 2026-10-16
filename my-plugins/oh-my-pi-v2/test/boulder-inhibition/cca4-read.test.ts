import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BOULDER_INHIBIT_ENTRY_TYPE,
	type BoulderEntryLike,
} from "../../boulder-inhibition/protocol.ts";
import { readBoulderInhibition } from "../../boulder-inhibition/read-inhibition.ts";

test("missing branch elements do not discard older valid inhibition signals", () => {
	const entries: BoulderEntryLike[] = [
		{
			type: "custom",
			customType: BOULDER_INHIBIT_ENTRY_TYPE,
			data: { type: "loop", value: true },
		},
	];
	entries.length = 2;
	assert.deepEqual(readBoulderInhibition(entries).blockers, ["loop"]);
});
