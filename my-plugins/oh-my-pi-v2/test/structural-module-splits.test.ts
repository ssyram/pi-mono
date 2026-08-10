import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLazyComments } from "../hooks/comment-checker-patterns.js";
import { extractReferencedFiles, shouldApplyRule } from "../hooks/rule-applicability.js";
import type { ParsedRule } from "../hooks/rule-definition.js";
import { parseRuleFrontmatter } from "../hooks/rule-frontmatter.js";
import { SISYPHUS_PROMPT_CORE } from "../hooks/sisyphus-prompt-core.js";
import { SISYPHUS_PROMPT_EXECUTION } from "../hooks/sisyphus-prompt-execution.js";
import { SISYPHUS_PROMPT_QUALITY } from "../hooks/sisyphus-prompt-quality.js";
import {
	extractStageOneForm,
	extractStageTwoDocument,
	parseMomusFinalReview,
	parseMomusGateOneResponse,
} from "../commands/start-work-parsing.js";

describe("mechanically split source modules", () => {
	it("preserves start-work parsing behavior", () => {
		assert.equal(extractStageOneForm("```yaml\nintent: x\ndesign_approach: y\ncomponents: z\n```"), "intent: x\ndesign_approach: y\ncomponents: z");
		assert.equal(extractStageTwoDocument("```markdown\n# Intent\nbody\n```"), "# Intent\nbody");
		assert.deepEqual(parseMomusGateOneResponse("status: APPROVED\nfindings: |\nclear"), {
			status: "APPROVED",
			findings: "clear",
		});
		assert.deepEqual(parseMomusFinalReview("**Action**: SUPPLEMENT\n**Rationale**: Add detail"), {
			action: "SUPPLEMENT",
			rationale: "Add detail",
		});
	});

	it("preserves rule frontmatter and applicability", () => {
		const { metadata, body } = parseRuleFrontmatter("---\ndescription: sample\nglobs: [\"*.ts\", \"*.tsx\"]\n---\nRule body");
		assert.deepEqual(metadata, { description: "sample", globs: ["*.ts", "*.tsx"] });
		assert.equal(body, "Rule body");
		const rule: ParsedRule = { name: "sample", body, metadata, hash: "hash", source: "test" };
		assert.equal(shouldApplyRule(rule, ["file.ts"]), true);
		assert.equal(shouldApplyRule(rule, ["README.md"]), false);
		assert.deepEqual(extractReferencedFiles("Edit src/file.ts and https://example.com/a.ts"), ["src/file.ts"]);
	});

	it("preserves lazy comment detection and prompt segment order", () => {
		const stderr = '<comment line-number="3">// implementation here</comment>\n<comment line-number="4">// useful explanation</comment>';
		assert.deepEqual(parseLazyComments(stderr), [{ line: 3, text: "// implementation here" }]);
		const prompt = SISYPHUS_PROMPT_CORE + SISYPHUS_PROMPT_EXECUTION + SISYPHUS_PROMPT_QUALITY;
		assert.ok(prompt.indexOf("<Role>") < prompt.indexOf("<Completion_Template>"));
		assert.ok(prompt.indexOf("<Completion_Template>") < prompt.indexOf("<Verification>"));
		assert.ok(prompt.endsWith("</Anti_Patterns>\n"));
	});
});
