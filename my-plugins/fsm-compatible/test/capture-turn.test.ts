import assert from "node:assert/strict";
import test from "node:test";
import { Ajv } from "ajv";
import { CaptureTurn } from "../src/judge/capture-turn.ts";
import { conflictSnapshot, structuredOutputParts } from "../src/judge/judge-envelope.ts";
import { RuntimeError } from "../src/runtime/runtime-error.ts";

const schema = { type: "object", properties: { verdict: { type: "string", enum: ["allow", "block"] } },
	required: ["verdict"], additionalProperties: false };

function validateOf(schemaValue: unknown) {
	return new Ajv({ strict: false, allErrors: true }).compile(schemaValue as never);
}

test("capture ledger records valid captures, keeps failures separate and never overwrites conflicts", () => {
	const turn = new CaptureTurn(validateOf(schema));
	const first = turn.capture("call-1", { verdict: "allow" });
	assert.equal(first.kind, "captured");
	assert.equal(first.terminate, true);
	const invalid = turn.capture("call-2", { verdict: "nope" });
	assert.equal(invalid.kind, "invalid");
	assert.equal(invalid.terminate, false);
	assert.match(invalid.content, /schema validation/);
	const second = turn.capture("call-3", { verdict: "block" });
	assert.equal(second.kind, "captured");
	assert.equal(turn.captures.length, 2);
	assert.equal(turn.failedAttempts.length, 1);
	assert.deepEqual(conflictSnapshot(turn), { conflicting: true, distinctValues: 2 });
	assert.deepEqual(structuredOutputParts(turn, "judge-1", "entry-9").map((part) => part.type === "tool" ? part.state.status : part.type),
		["error", "completed", "completed"]);
	const repeated = turn.capture("call-4", { verdict: "allow" });
	assert.equal(repeated.kind, "captured");
	assert.deepEqual(conflictSnapshot(turn), { conflicting: true, distinctValues: 2 });
	assert.throws(() => turn.capture("", { verdict: "allow" }), { code: RuntimeError ? "protocol-invalid" : "" });
});

test("turn reset drops stale captures for same-session repair", () => {
	const turn = new CaptureTurn(validateOf(schema));
	turn.capture("old", { verdict: "allow" });
	turn.reset(validateOf({ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] }));
	assert.equal(turn.captures.length, 0);
	assert.equal(turn.capture("new", { verdict: "anything-new-schema" }).kind, "captured");
});
