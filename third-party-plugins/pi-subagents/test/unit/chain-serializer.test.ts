import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChain, serializeChain } from "../../src/agents/chain-serializer.ts";

const chainContent = `---
name: review-chain
description: Review chain
---

## reviewer
output: report.md
outputMode: file-only

Review the diff
`;

describe("chain serializer", () => {
	it("round-trips step outputMode", () => {
		const parsed = parseChain(chainContent, "project", "/tmp/review-chain.md");

		assert.equal(parsed.steps[0]?.outputMode, "file-only");
		assert.match(serializeChain(parsed), /outputMode: file-only/);
	});
});
