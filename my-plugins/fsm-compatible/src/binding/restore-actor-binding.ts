import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "../admission/admission-result.ts";
import { BINDING_CUSTOM_TYPE, type BindingRecords, type PersistedBinding } from "./actor-binding.ts";
import { parentDepth } from "./parent-chain.ts";
import { readPersistedBinding } from "./read-persisted-binding.ts";

export function restoreActorBinding(
	policy: AdmissionPolicy,
	saved: PersistedBinding,
	actualSessionId: string,
	callerRoot: string,
	records: BindingRecords,
): AdmissionResult<PersistedBinding> {
	// Step P7: validate the saved baseline, never derive it from the current policy.
	const checked = readPersistedBinding([{ type: "custom", customType: BINDING_CUSTOM_TYPE, data: saved }], actualSessionId);
	if (!checked.ok || !checked.value || checked.value.rootSessionId !== callerRoot) return rejected("restore-conflict");
	const binding = checked.value;
	for (const original of binding.requiredExtensions) {
		if (!policy.requiredExtensions.some((item) => item.id === original.id && item.path === original.path && item.requireForAllRunners === true)) {
			return rejected("restore-conflict");
		}
	}
	if (binding.kind === "execution-child") {
		if (!policy.agents.some((agent) => agent.canonicalName === binding.agentName)) return rejected("restore-conflict");
		const depth = parentDepth(callerRoot, binding.parentSessionId, records, actualSessionId);
		if (!depth.ok || depth.value >= policy.maxDepth) return rejected("restore-conflict");
	}
	// Root does not have a child agentName or parent; its identity was checked above.
	return admitted(Object.freeze({
		...binding,
		requiredExtensions: Object.freeze(policy.requiredExtensions.map(({ id, path }) => Object.freeze({ id, path }))),
	}));
}
