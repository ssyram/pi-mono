import assert from "node:assert/strict";
import test from "node:test";
import { BINDING_CUSTOM_TYPE, type BindingEntry } from "../src/binding/actor-binding.ts";
import { bindNewChild } from "../src/binding/bind-new-child.ts";
import { createRootBinding } from "../src/binding/create-root-binding.ts";
import { parentDepth } from "../src/binding/parent-chain.ts";
import { readPersistedBinding } from "../src/binding/read-persisted-binding.ts";
import { restoreActorBinding } from "../src/binding/restore-actor-binding.ts";
import { child, expectCode, extraExtension, pending, policy, records, root, selfExtension, unwrap } from "./admission-fixtures.ts";

function entries(data: unknown): BindingEntry[] {
	return [{ type: "custom", customType: BINDING_CUSTOM_TYPE, data }];
}

test("root binding includes the original non-secret mandatory baseline", () => {
	const source = policy([], [selfExtension, extraExtension]);
	const binding = createRootBinding("r", source);
	assert.equal(binding.agentId, "main");
	assert.equal(binding.parentSessionId, null);
	assert.equal(binding.agentName, null);
	assert.deepEqual(binding.requiredExtensions, [{ id: "fsm-compatible", path: "/plugin/index.ts" }, { id: "extra", path: "/plugin/extra.ts" }]);
	assert.ok(Object.isFrozen(binding) && Object.isFrozen(binding.requiredExtensions));
	assert.throws(() => createRootBinding(" r", source));
});

test("missing and damaged saved bindings are never conflated", () => {
	assert.equal(unwrap(readPersistedBinding([], "r")), null);
	assert.equal(unwrap(readPersistedBinding([{ type: "custom_message", customType: BINDING_CUSTOM_TYPE }], "r")), null);
	const binding = root();
	for (const key of Object.keys(binding)) {
		const damaged: Record<string, unknown> = { ...binding };
		delete damaged[key];
		expectCode(readPersistedBinding(entries(damaged), "r"), "binding-mismatch");
	}
	for (const damaged of [null, { ...binding, version: 2 }, { ...binding, sessionId: "other" },
		{ ...binding, requiredExtensions: [] }, { ...binding, token: "not-allowed" },
		{ ...binding, requiredExtensions: [{ id: "fsm-compatible", path: "relative.ts" }] },
		{ ...binding, requiredExtensions: [{ id: "fsm-compatible", path: "/a" }, { id: "fsm-compatible", path: "/b" }] }]) {
		expectCode(readPersistedBinding(entries(damaged), "r"), "binding-mismatch");
	}
	assert.deepEqual(unwrap(readPersistedBinding(entries(binding), "r")), binding);
	assert.deepEqual(unwrap(readPersistedBinding(entries(child()), "c")), child());
	expectCode(readPersistedBinding(entries(child("r", "main")), "main"), "binding-mismatch");
});

test("only latest binding on the provided real branch is considered", () => {
	const binding = root();
	expectCode(readPersistedBinding([...entries(binding), ...entries({})], "r"), "binding-mismatch");
	assert.deepEqual(unwrap(readPersistedBinding([...entries({}), ...entries(binding)], "r")), binding);
});

test("B2: legitimate root restores without child allowlist or parent lookup", () => {
	const source = policy([], [selfExtension, extraExtension]);
	const saved = root(source);
	let lookups = 0;
	const empty = { find: () => { lookups++; return undefined; } };
	assert.deepEqual(unwrap(restoreActorBinding(source, saved, "r", "r", empty)), saved);
	assert.equal(lookups, 0);
	expectCode(restoreActorBinding(source, saved, "r", "other", empty), "restore-conflict");
	expectCode(restoreActorBinding(source, saved, "other", "r", empty), "restore-conflict");
});

test("B1: original mandatory deletion/replacement is rejected; additions become the next baseline", () => {
	const original = policy([], [selfExtension, extraExtension]);
	const saved = root(original);
	const empty = records();
	expectCode(restoreActorBinding(policy([]), saved, "r", "r", empty), "restore-conflict");
	const replaced = { ...extraExtension, path: "/plugin/replaced.ts" };
	expectCode(restoreActorBinding(policy([], [selfExtension, replaced]), saved, "r", "r", empty), "restore-conflict");
	const added = { id: "added", path: "/plugin/added.ts", requireForAllRunners: true as const };
	const expanded = policy([], [selfExtension, extraExtension, added]);
	const next = unwrap(restoreActorBinding(expanded, saved, "r", "r", empty));
	assert.equal(saved.requiredExtensions.length, 2);
	assert.equal(next.requiredExtensions.length, 3);
	expectCode(restoreActorBinding(original, next, "r", "r", empty), "restore-conflict");
	const savedChild = child("r", "c", policy(["a"], [selfExtension, extraExtension]));
	expectCode(restoreActorBinding(policy(), savedChild, "c", "r", records(root())), "restore-conflict");
});

test("child restore retains every identity field and validates actual parent/agent/depth", () => {
	const source = policy();
	const saved = child();
	const tree = records(root());
	assert.deepEqual(unwrap(restoreActorBinding(source, saved, "c", "r", tree)), saved);
	expectCode(restoreActorBinding(policy([]), saved, "c", "r", tree), "restore-conflict");
	expectCode(restoreActorBinding(source, saved, "c", "r", records()), "restore-conflict");
	expectCode(restoreActorBinding(source, saved, "c", "other", tree), "restore-conflict");
	expectCode(restoreActorBinding(source, { ...saved, agentId: "new-run-id" }, "c", "r", tree), "restore-conflict");
	const deep = child("c", "d");
	expectCode(restoreActorBinding(policy(["a"], [selfExtension], 1), deep, "d", "r", records(root(), saved)), "restore-conflict");
});

test("C1: restoring into an existing descendant rejects the newly introduced parent cycle", () => {
	const source = policy();
	const current = child("r", "c", source);
	assert.ok(current.kind === "execution-child");
	const descendant = child("c", "d", source);
	const tree = records(root(source), current, descendant);
	const saved = { ...current, parentSessionId: "d" };
	const before = structuredClone(saved);
	assert.equal(unwrap(parentDepth("r", "d", tree)), 2);
	expectCode(restoreActorBinding(source, saved, "c", "r", tree), "restore-conflict");
	assert.deepEqual(saved, before);
	assert.equal(tree.find("c")?.binding.parentSessionId, "r");
});

test("new launch binds one actual self and failure has no registration mutation", () => {
	const source = policy();
	const launch = pending(source);
	const tree = records(root(source));
	const reserved = pending(source);
	expectCode(bindNewChild(source, reserved, "main", [], tree), "binding-mismatch");
	assert.equal(reserved.state, "allocated");
	const bound = unwrap(bindNewChild(source, launch, "c", [], tree));
	assert.equal(launch.state, "registered");
	assert.equal(launch.registeredSessionId, "c");
	assert.equal(bound.agentId, "c");
	assert.deepEqual(unwrap(bindNewChild(source, launch, "c", [], tree)), bound);
	expectCode(bindNewChild(source, launch, "d", [], tree), "binding-mismatch");
	assert.equal(launch.registeredSessionId, "c");
	for (const run of [pending(source), { ...pending(source), state: "cancelled" as const }]) {
		const before = { ...run };
		const result = bindNewChild(source, run, "c", entries({}), tree);
		assert.equal(result.ok, false);
		assert.deepEqual(run, before);
	}
});

test("existing saved binding goes through restore, never new fallback", () => {
	const source = policy();
	const launch = pending(source);
	const saved = child();
	assert.deepEqual(unwrap(bindNewChild(source, launch, "c", entries(saved), records(root()))), saved);
	const different = pending(source);
	expectCode(bindNewChild(source, different, "c", entries({ ...saved, parentSessionId: "missing" }), records(root())), "binding-mismatch");
	assert.equal(different.state, "allocated");
});

test("finite parent chains terminate on missing, cross-root and cycles", () => {
	assert.equal(unwrap(parentDepth("r", "r", records(root()))), 0);
	assert.equal(unwrap(parentDepth("r", "d", records(root(), child(), child("c", "d")))), 2);
	expectCode(parentDepth("r", "missing", records(root())), "parent-not-found");
	expectCode(parentDepth("other", "c", records(root(), child())), "binding-mismatch");
	expectCode(parentDepth("r", "main", records(root(), child("r", "main"))), "binding-mismatch");
	expectCode(parentDepth("r", "c", records(child("d", "c"), child("c", "d"))), "parent-cycle");
});
