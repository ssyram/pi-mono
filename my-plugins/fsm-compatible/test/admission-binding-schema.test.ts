import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv } from "ajv";
import { parsePolicyInput } from "../src/admission/parse-policy-input.ts";
import { BINDING_CUSTOM_TYPE } from "../src/binding/actor-binding.ts";
import { readPersistedBinding } from "../src/binding/read-persisted-binding.ts";
import { child, root } from "./admission-fixtures.ts";

const schema = JSON.parse(readFileSync(new URL("../docs/design/fsm-compatibility/subplans/fsm-1-admission-binding.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addSchema(schema);
const policySchema = ajv.getSchema(`${schema.$id}#/definitions/PolicyInput`);
const launchSchema = ajv.getSchema(`${schema.$id}#/definitions/LaunchRequest`);
const bindingSchema = ajv.getSchema(`${schema.$id}#/definitions/PersistedBinding`);
assert.ok(policySchema && launchSchema && bindingSchema);

test("shape schema and policy parser reject the same authority field errors", () => {
	const valid = { allowedAgentNames: ["a"], requiredExtensions: [], maxDepth: 8 };
	const cases = [valid, { ...valid, allowedAgentNames: [] }, null, [], { ...valid, allowedAgentNames: ["a", "a"] },
		{ ...valid, allowedAgentNames: [" a"] }, { ...valid, maxDepth: 0 }, { ...valid, maxDepth: 1.5 },
		{ ...valid, internal: true }, { ...valid, requiredExtensions: [{ id: "a", path: "" }] }];
	for (const value of cases) assert.equal(parsePolicyInput(value).ok, policySchema(value), JSON.stringify(value));
});

test("launch shape rejects all model-controlled authority fields", () => {
	const valid = { agentName: "a", executionMode: "async" };
	assert.equal(launchSchema(valid), true);
	for (const key of ["rootSessionId", "callerSessionId", "internal", "runner", "extensions", "policy"]) {
		assert.equal(launchSchema({ ...valid, [key]: true }), false);
	}
	assert.equal(launchSchema({ ...valid, executionMode: "external" }), false);
});

test("binding shape requires root/child variants and original mandatory baseline", () => {
	for (const binding of [root(), child()]) {
		assert.equal(bindingSchema(binding), true);
		const entries = [{ type: "custom", customType: BINDING_CUSTOM_TYPE, data: binding }];
		assert.equal(readPersistedBinding(entries, binding.sessionId).ok, true);
		for (const key of Object.keys(binding)) {
			const damaged: Record<string, unknown> = { ...binding };
			delete damaged[key];
			assert.equal(bindingSchema(damaged), false, key);
			assert.equal(readPersistedBinding([{ ...entries[0], type: "custom", data: damaged }], binding.sessionId).ok, false, key);
		}
	}
	assert.equal(bindingSchema({ ...root(), requiredExtensions: [] }), false);
	assert.equal(bindingSchema({ ...root(), requiredExtensions: [{ id: "other", path: "/other.ts" }] }), false);
	assert.equal(bindingSchema({ ...root(), parentSessionId: "p" }), false);
});

test("shape success does not replace identity, duplicate-path or absolute-path semantics", () => {
	const wrongSelf = { ...root(), sessionId: "other" };
	assert.equal(bindingSchema(wrongSelf), true);
	assert.equal(readPersistedBinding([{ type: "custom", customType: BINDING_CUSTOM_TYPE, data: wrongSelf }], "other").ok, false);
	const relative = { ...root(), requiredExtensions: [{ id: "fsm-compatible", path: "relative.ts" }] };
	assert.equal(bindingSchema(relative), true);
	assert.equal(readPersistedBinding([{ type: "custom", customType: BINDING_CUSTOM_TYPE, data: relative }], "r").ok, false);
});
