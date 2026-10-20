import assert from "node:assert/strict";
import type { AdmissionPolicy, PolicyInput, RequiredExtension, ResolvedAgent } from "../src/admission/admission-policy.ts";
import type { AdmissionErrorCode, AdmissionResult } from "../src/admission/admission-result.ts";
import { buildAdmissionPolicy } from "../src/admission/build-admission-policy.ts";
import type { BindingRecords, PendingLaunch, PersistedBinding } from "../src/binding/actor-binding.ts";
import { createRootBinding } from "../src/binding/create-root-binding.ts";

export const selfExtension: RequiredExtension = Object.freeze({ id: "fsm-compatible", path: "/plugin/index.ts", requireForAllRunners: true });
export const extraExtension: RequiredExtension = Object.freeze({ id: "extra", path: "/plugin/extra.ts", requireForAllRunners: true });

export function unwrap<T>(result: AdmissionResult<T>): T {
	assert.ok(result.ok, JSON.stringify(result));
	return result.value;
}

export function expectCode(result: AdmissionResult<unknown>, code: AdmissionErrorCode): void {
	assert.deepEqual(result, { ok: false, code });
}

export function agent(name: string, ceiling: readonly string[] | null = null): ResolvedAgent {
	return {
		canonicalName: name,
		runtimeName: `fsm-${name}`,
		definitionSnapshot: { systemPrompt: name, tools: ["read"] },
		declaredToolCeiling: ceiling,
	};
}

export function policy(names: readonly string[] = ["a"], extensions: readonly RequiredExtension[] = [selfExtension], maxDepth = 8): AdmissionPolicy {
	const input: PolicyInput = { allowedAgentNames: names, requiredExtensions: [], maxDepth };
	return unwrap(buildAdmissionPolicy(input, names.map((name) => agent(name)), extensions));
}

export function records(...bindings: PersistedBinding[]): BindingRecords {
	const data = new Map(bindings.map((binding) => [binding.sessionId, { binding }]));
	return { find: (sessionId) => data.get(sessionId) };
}

export function child(parentSessionId = "r", sessionId = "c", source = policy()): PersistedBinding {
	return {
		version: 1,
		rootSessionId: "r",
		sessionId,
		agentId: sessionId,
		kind: "execution-child",
		parentSessionId,
		agentName: "a",
		bootstrapRef: "/plugin/bootstrap-ref",
		requiredExtensions: source.requiredExtensions.map(({ id, path }) => ({ id, path })),
	};
}

export function pending(source = policy()): PendingLaunch {
	return {
		rootSessionId: "r",
		callerSessionId: "r",
		agentName: "a",
		bootstrapRef: "/plugin/bootstrap-ref",
		policy: source,
		state: "allocated",
		registeredSessionId: null,
	};
}

export function root(source = policy()): PersistedBinding {
	return createRootBinding("r", source);
}

export function subsets<T>(values: readonly T[]): T[][] {
	const result: T[][] = [];
	for (let mask = 0; mask < 2 ** values.length; mask++) {
		result.push(values.filter((_value, index) => Boolean(mask & (1 << index))));
	}
	return result;
}
