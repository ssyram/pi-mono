import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "../admission/admission-result.ts";
import { isAdmissionIdentifier } from "../admission/parse-policy-input.ts";
import type { BindingEntry, BindingRecords, PendingLaunch, PersistedBinding } from "./actor-binding.ts";
import { parentDepth } from "./parent-chain.ts";
import { readPersistedBinding } from "./read-persisted-binding.ts";
import { restoreActorBinding } from "./restore-actor-binding.ts";

export function bindNewChild(
	policy: AdmissionPolicy,
	pending: PendingLaunch,
	actualSessionId: string,
	entries: readonly BindingEntry[],
	records: BindingRecords,
): AdmissionResult<PersistedBinding> {
	// Step P6: check everything before changing the launch's single actual identity.
	if (pending.state === "failed" || pending.state === "cancelled" || !isAdmissionIdentifier(actualSessionId)
		|| actualSessionId === pending.rootSessionId || actualSessionId === "main" || !isAdmissionIdentifier(pending.bootstrapRef)) return rejected("binding-mismatch");
	if (pending.registeredSessionId !== null && pending.registeredSessionId !== actualSessionId) return rejected("binding-mismatch");
	if (!policy.agents.some((agent) => agent.canonicalName === pending.agentName)) return rejected("agent-not-admitted");
	for (const extension of pending.policy.requiredExtensions) {
		if (!policy.requiredExtensions.some((item) => item.id === extension.id && item.path === extension.path && item.requireForAllRunners === true)) {
			return rejected("required-extension-mismatch");
		}
	}
	const depth = parentDepth(pending.rootSessionId, pending.callerSessionId, records, actualSessionId);
	if (!depth.ok) return depth;
	if (depth.value >= policy.maxDepth) return rejected("depth-exceeded");
	const saved = readPersistedBinding(entries, actualSessionId);
	if (!saved.ok) return saved;
	const existing = records.find(actualSessionId)?.binding;
	if (existing && (existing.kind !== "execution-child" || existing.rootSessionId !== pending.rootSessionId
		|| existing.parentSessionId !== pending.callerSessionId || existing.agentName !== pending.agentName
		|| existing.bootstrapRef !== pending.bootstrapRef)) return rejected("binding-mismatch");
	let result: AdmissionResult<PersistedBinding>;
	if (saved.value) {
		if (saved.value.kind !== "execution-child" || saved.value.parentSessionId !== pending.callerSessionId
			|| saved.value.agentName !== pending.agentName || saved.value.bootstrapRef !== pending.bootstrapRef) return rejected("binding-mismatch");
		result = restoreActorBinding(policy, saved.value, actualSessionId, pending.rootSessionId, records);
	} else {
		result = admitted(Object.freeze({
			version: 1,
			rootSessionId: pending.rootSessionId,
			sessionId: actualSessionId,
			agentId: actualSessionId,
			kind: "execution-child",
			parentSessionId: pending.callerSessionId,
			agentName: pending.agentName,
			bootstrapRef: pending.bootstrapRef,
			requiredExtensions: Object.freeze(policy.requiredExtensions.map(({ id, path }) => Object.freeze({ id, path }))),
		}));
	}
	if (!result.ok) return result;
	pending.registeredSessionId = actualSessionId;
	if (pending.state === "allocated") pending.state = "registered";
	return result;
}
