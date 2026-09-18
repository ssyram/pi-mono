import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompactionReferenceInstructions } from "../hooks/compaction-reference-prompt.js";

describe("compaction reference instructions", () => {
	it("explains precisely the optional grammar, boundaries and literal layers", () => {
		const text = buildCompactionReferenceInstructions();
		for (const required of [
			"free-form",
			"not mandatory",
			"@!1@",
			"@!1[2:8]@",
			"@!1~3@",
			"@!(1~3)[2:8]@",
			"[2..8]",
			"@!@",
			"code points",
			"negative",
			"@|!",
			"@||!",
			"cannot cross messages",
			"not necessarily a user quote",
			"tool calls/results",
			"file lists",
		]) {
			assert.ok(text.includes(required), required);
		}
		assert.equal(buildCompactionReferenceInstructions(), text);
		assert.doesNotMatch(
			text,
			/old \/ potential|<current_history>|selectedEntryIds|\.pos\(\)/,
		);
	});
});
