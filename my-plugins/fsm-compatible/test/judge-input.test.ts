import assert from "node:assert/strict";
import test from "node:test";
import { parseJudgeInput } from "../src/judge/judge-input.ts";
import { resolveJudgeToolPolicy } from "../src/judge/judge-tool-policy.ts";
import { RuntimeError } from "../src/runtime/runtime-error.ts";

const baseRequest = {
	system: "judge system",
	tools: { "*": false, StructuredOutput: true },
	format: { type: "json_schema", schema: { type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"], additionalProperties: false } },
	parts: [{ type: "text", text: "first" }, { type: "text", text: "second" }],
};

test("judge input parses strictly, joins parts in order and compiles the wire schema", () => {
	const input = parseJudgeInput(baseRequest);
	assert.equal(input.user, "first\nsecond");
	assert.equal(input.system, "judge system");
	assert.equal(input.validate({ verdict: "block" }), true);
	assert.equal(input.validate({ verdict: "block", extra: 1 }), false);
	for (const bad of [
		{ ...baseRequest, unknown: 1 },
		{ ...baseRequest, system: "" },
		{ ...baseRequest, parts: [] },
		{ ...baseRequest, parts: [{ type: "image" }] },
		{ ...baseRequest, format: { type: "other", schema: {} } },
		{ ...baseRequest, format: { type: "json_schema", schema: "nope" } },
	]) assert.throws(() => parseJudgeInput(bad), { code: "protocol-invalid" });
});

test("tool policy keeps base tools, honors extras and never enables aliases or unknowns", () => {
	const minimal = resolveJudgeToolPolicy({ "*": false, StructuredOutput: true });
	assert.deepEqual([...minimal.allowed].sort(), ["glob", "grep", "read"]);
	assert.equal(minimal.externalDirectory, false);
	const full = resolveJudgeToolPolicy({ "*": false, StructuredOutput: true, bash: true, edit: true,
		webfetch: true, websearch: true, external_directory: true, write: false, read_mcp_resource: false });
	assert.equal(full.allowed.has("bash"), true);
	assert.equal(full.externalDirectory, true);
	for (const bad of [
		{ StructuredOutput: true },
		{ "*": false },
		{ "*": false, StructuredOutput: true, write: true },
		{ "*": false, StructuredOutput: true, apply_patch: true },
		{ "*": false, StructuredOutput: true, made_up: true },
	]) assert.throws(() => resolveJudgeToolPolicy(bad), { code: "protocol-invalid" });
	// unknown/deny false entries stay inert
	assert.doesNotThrow(() => resolveJudgeToolPolicy({ "*": false, StructuredOutput: true, made_up: false }));
	assert.equal(resolveJudgeToolPolicy({ "*": false, StructuredOutput: true, bash: false }).allowed.has("bash"), false);
});
