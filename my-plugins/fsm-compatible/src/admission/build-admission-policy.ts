import type { AdmissionPolicy, PolicyInput, RequiredExtension, ResolvedAgent } from "./admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "./admission-result.ts";
import { isAdmissionIdentifier, isAdmissionObject } from "./parse-policy-input.ts";
import { snapshotAgentDefinition } from "./snapshot-agent-definition.ts";
import { isDataArray } from "./data-array.ts";

export function buildAdmissionPolicy(
	input: PolicyInput,
	agents: readonly ResolvedAgent[],
	extensions: readonly RequiredExtension[],
): AdmissionResult<AdmissionPolicy> {
	// Step P3: only the explicit canonical list selects definitions.
	const selected: ResolvedAgent[] = [];
	for (const name of input.allowedAgentNames) {
		const matches = agents.filter((agent) => agent.canonicalName === name);
		if (matches.length !== 1) return rejected("agent-not-admitted");
		const candidate = matches[0];
		if (!candidate || !isAdmissionIdentifier(candidate.runtimeName)) return rejected("invalid-input");
		if ((candidate.runnerType !== undefined && candidate.runnerType !== "pi") || candidate.machine !== undefined) {
			return rejected("runner-not-admitted");
		}
		const snapshot = snapshotAgentDefinition(candidate.definitionSnapshot);
		if (!snapshot.ok) return snapshot;
		const runner = snapshot.value.runner;
		if (snapshot.value.machine !== undefined || (runner !== undefined && (
			!isAdmissionObject(runner) || runner.type !== "pi" || Object.keys(runner).some((key) => key !== "type")
		))) return rejected("runner-not-admitted");
		if (candidate.declaredToolCeiling !== null && (!isDataArray(candidate.declaredToolCeiling) || !candidate.declaredToolCeiling.every(isAdmissionIdentifier))) {
			return rejected("invalid-input");
		}
		selected.push(Object.freeze({
			canonicalName: name,
			runtimeName: candidate.runtimeName,
			runnerType: "pi",
			definitionSnapshot: snapshot.value,
			declaredToolCeiling: candidate.declaredToolCeiling === null ? null : Object.freeze([...candidate.declaredToolCeiling]),
		}));
	}
	return admitted(Object.freeze({
		agents: Object.freeze(selected),
		requiredExtensions: Object.freeze(extensions.map((extension) => Object.freeze({ ...extension }))),
		maxDepth: input.maxDepth,
	}));
}
