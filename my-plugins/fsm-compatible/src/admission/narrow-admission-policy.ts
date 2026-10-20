import type { AdmissionPolicy, PolicyInput, RequiredExtension } from "./admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "./admission-result.ts";

export function narrowAdmissionPolicy(
	parent: AdmissionPolicy,
	requested: PolicyInput,
	extensions: readonly RequiredExtension[],
): AdmissionResult<AdmissionPolicy> {
	// Step P4: retain parent definitions and all mandatory paths.
	if (requested.maxDepth > parent.maxDepth) return rejected("policy-widened");
	for (const extension of parent.requiredExtensions) {
		if (!extensions.some((item) => item.id === extension.id && item.path === extension.path && item.requireForAllRunners === true)) {
			return rejected("policy-widened");
		}
	}
	const selected = [];
	for (const name of requested.allowedAgentNames) {
		const agent = parent.agents.find((item) => item.canonicalName === name);
		if (!agent) return rejected("policy-widened");
		selected.push(agent);
	}
	return admitted(Object.freeze({
		agents: Object.freeze(selected),
		requiredExtensions: Object.freeze(extensions.map((item) => Object.freeze({ ...item }))),
		maxDepth: requested.maxDepth,
	}));
}
