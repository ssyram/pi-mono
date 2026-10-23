import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import type { RequiredExtension } from "../src/admission/admission-policy.ts";
import { admitChildLaunch } from "../src/admission/admit-child-launch.ts";
import { ROOT_SID } from "./admission-fixtures.ts";
import { buildAdmissionPolicy } from "../src/admission/build-admission-policy.ts";
import { canonicalizeRequiredExtensions } from "../src/admission/canonicalize-required-extensions.ts";
import { narrowAdmissionPolicy } from "../src/admission/narrow-admission-policy.ts";
import { parsePolicyInput } from "../src/admission/parse-policy-input.ts";
import { snapshotAgentDefinition } from "../src/admission/snapshot-agent-definition.ts";
import { agent, child, expectCode, extraExtension, policy, records, root, selfExtension, subsets, unwrap } from "./admission-fixtures.ts";

const tools = { availableToolNames: ["read", "bash", "fsm_agent", "mcp__fsm__fsm_get_state"], requiredToolNames: ["fsm_agent", "mcp__fsm__fsm_get_state"] };
const caller = { rootSessionId: ROOT_SID, sessionId: "r" };
const request = { agentName: "a", executionMode: "sync" };

test("strict policy input rejects unknown, duplicate, whitespace, unsafe, accessor and sparse inputs", () => {
	const input = { allowedAgentNames: ["a"], requiredExtensions: [], maxDepth: 8 };
	assert.equal(parsePolicyInput(input).ok, true);
	for (const value of [null, [], { ...input, internal: true }, { ...input, maxDepth: 0 }, { ...input, maxDepth: Infinity },
		{ ...input, allowedAgentNames: ["a", "a"] }, { ...input, allowedAgentNames: [" a"] },
		{ ...input, allowedAgentNames: ["a\0"] }, { ...input, allowedAgentNames: new Array(1) },
		{ ...input, requiredExtensions: [{ id: "self", path: "/a", requireForAllRunners: true }] }]) {
		expectCode(parsePolicyInput(value), "invalid-input");
	}
	let called = false;
	const accessor = Object.defineProperty({}, "allowedAgentNames", { enumerable: true, get: () => { called = true; return []; } });
	expectCode(parsePolicyInput(accessor), "invalid-input");
	assert.equal(called, false);
});

test("canonical mandatory snapshot inspects real files but never executes extensions", () => {
	const tempBase = fileURLToPath(new URL("./.tmp/", import.meta.url));
	mkdirSync(tempBase, { recursive: true });
	const dir = mkdtempSync(join(tempBase, "required-"));
	try {
		const self = join(dir, "self.ts");
		const extra = join(dir, "extra.ts");
		writeFileSync(self, "throw new Error('must not execute')\n");
		writeFileSync(extra, "throw new Error('must not execute')\n");
		const alias = join(dir, "alias.ts");
		symlinkSync(extra, alias);
		const snapshot = unwrap(canonicalizeRequiredExtensions([{ id: "x", path: alias }], self));
		assert.deepEqual(snapshot, [{ id: "x", path: extra, requireForAllRunners: true }, { id: "fsm-compatible", path: self, requireForAllRunners: true }]);
		assert.ok(Object.isFrozen(snapshot) && snapshot.every(Object.isFrozen));
		expectCode(canonicalizeRequiredExtensions([{ id: "fsm-compatible", path: extra }], self), "required-extension-mismatch");
		expectCode(canonicalizeRequiredExtensions([{ id: "x", path: alias }, { id: "y", path: extra }], self), "required-extension-mismatch");
		expectCode(canonicalizeRequiredExtensions([{ id: "x", path: dir }], self), "required-extension-mismatch");
		expectCode(canonicalizeRequiredExtensions([{ id: "x", path: join(dir, "missing") }], self), "required-extension-mismatch");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("mandatory limit applies after adding self", () => {
	const files = { realpath: (path: string) => path, isFile: () => true };
	const input = Array.from({ length: 32 }, (_value, index) => ({ id: `x${index}`, path: `/x${index}.ts` }));
	expectCode(canonicalizeRequiredExtensions(input, "/self.ts", files), "required-extension-mismatch");
	assert.equal(unwrap(canonicalizeRequiredExtensions(input.slice(1), "/self.ts", files)).length, 32);
});

test("only exact canonical native agent definitions enter a fixed snapshot", () => {
	const input = { allowedAgentNames: ["a"], requiredExtensions: [], maxDepth: 8 };
	const selected = unwrap(buildAdmissionPolicy(input, [agent("a"), agent("discovered")], [selfExtension]));
	assert.deepEqual(selected.agents.map((item) => item.canonicalName), ["a"]);
	for (const invalid of [{ ...agent("a"), runnerType: "external-cli" }, { ...agent("a"), machine: "remote" },
		{ ...agent("a"), definitionSnapshot: { runner: { type: "external-cli" } } }]) {
		expectCode(buildAdmissionPolicy(input, [invalid], [selfExtension]), "runner-not-admitted");
	}
	expectCode(buildAdmissionPolicy(input, [agent("other")], [selfExtension]), "agent-not-admitted");
	expectCode(buildAdmissionPolicy(input, [agent("a"), agent("a")], [selfExtension]), "agent-not-admitted");
	assert.equal(policy([]).agents.length, 0);
});

test("public definition snapshots are deep frozen copies and malformed JSON is rejected", () => {
	const definition = { nested: { flag: true }, values: ["read"] };
	const source = { ...agent("a"), definitionSnapshot: definition };
	const fixed = unwrap(buildAdmissionPolicy({ allowedAgentNames: ["a"], requiredExtensions: [], maxDepth: 8 }, [source], [selfExtension]));
	definition.nested.flag = false;
	definition.values.push("bash");
	assert.deepEqual(fixed.agents[0]?.definitionSnapshot, { nested: { flag: true }, values: ["read"] });
	assert.ok(Object.isFrozen(fixed.agents[0]?.definitionSnapshot.nested));
	assert.equal(Reflect.set(fixed.agents, "0", agent("x")), false);
	assert.equal(fixed.agents[0]?.canonicalName, "a");
	const cycle: Record<string, unknown> = {};
	cycle.self = cycle;
	for (const value of [cycle, { value: Infinity }, { value: undefined }, { value: new Date() }, { values: new Array(1) }]) {
		expectCode(snapshotAgentDefinition(value), "invalid-input");
	}
	const custom = ["read"];
	Object.defineProperty(custom, "00", { value: "hidden", enumerable: true });
	expectCode(snapshotAgentDefinition({ tools: custom }), "invalid-input");
});

test("all finite parent/descendant subsets obey admission monotonicity", () => {
	for (const parentNames of subsets(["a", "b", "c"])) {
		for (const childNames of subsets(["a", "b", "c"])) {
			const result = narrowAdmissionPolicy(policy(parentNames), { allowedAgentNames: childNames, requiredExtensions: [], maxDepth: 8 }, [selfExtension]);
			assert.equal(result.ok, childNames.every((name) => parentNames.includes(name)), JSON.stringify({ parentNames, childNames }));
			if (result.ok) assert.deepEqual(result.value.agents.map((item) => item.canonicalName), childNames);
		}
	}
});

test("descendants cannot remove or replace mandatory extensions or increase depth", () => {
	const source = policy(["a"], [selfExtension, extraExtension]);
	const wanted = { allowedAgentNames: ["a"], requiredExtensions: [], maxDepth: 8 };
	for (const extensionSet of subsets([selfExtension, extraExtension])) {
		const result = narrowAdmissionPolicy(source, wanted, extensionSet);
		assert.equal(result.ok, extensionSet.length === 2);
	}
	const replaced: RequiredExtension = { ...extraExtension, path: "/plugin/replaced.ts" };
	expectCode(narrowAdmissionPolicy(source, wanted, [selfExtension, replaced]), "policy-widened");
	expectCode(narrowAdmissionPolicy(source, { ...wanted, maxDepth: 9 }, source.requiredExtensions), "policy-widened");
	assert.equal(unwrap(narrowAdmissionPolicy(source, { ...wanted, maxDepth: 1 }, source.requiredExtensions)).maxDepth, 1);
});

test("launch validates actual caller, namespace, depth and required tools without effects", () => {
	const source = policy();
	const tree = records(root(source));
	const admitted = unwrap(admitChildLaunch(source, caller, request, tree, tools));
	assert.equal(admitted.callerSessionId, "r");
	assert.equal(admitted.bootstrapRef, null);
	assert.deepEqual(admitted.allowedToolNames, tools.availableToolNames);
	for (const field of ["rootSessionId", "callerSessionId", "internal", "runner", "extensions", "policy"]) {
		expectCode(admitChildLaunch(source, caller, { ...request, [field]: true }, tree, tools), "invalid-input");
	}
	expectCode(admitChildLaunch(source, caller, { ...request, agentName: "alias" }, tree, tools), "agent-not-admitted");
	expectCode(admitChildLaunch(policy([]), caller, request, tree, tools), "agent-not-admitted");
	expectCode(admitChildLaunch(source, { ...caller, sessionId: "missing" }, request, tree, tools), "parent-not-found");
	expectCode(admitChildLaunch(source, { ...caller, rootSessionId: "other" }, request, tree, tools), "binding-mismatch");
	const depthPolicy = policy(["a"], [selfExtension], 1);
	expectCode(admitChildLaunch(depthPolicy, { ...caller, sessionId: "c" }, request, records(root(depthPolicy), child("r", "c", depthPolicy)), tools), "depth-exceeded");
	const ceiling = unwrap(buildAdmissionPolicy({ allowedAgentNames: ["a"], requiredExtensions: [], maxDepth: 8 }, [agent("a", ["read"])], [selfExtension]));
	expectCode(admitChildLaunch(ceiling, caller, request, tree, tools), "policy-widened");
	expectCode(admitChildLaunch(source, caller, { ...request, resumeSessionFile: "/saved.jsonl" }, tree, tools), "restore-conflict");
});
