import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import { isAdmissionIdentifier } from "../admission/parse-policy-input.ts";
import type { ChildBinding } from "./actor-binding.ts";

/**
 * Child actor identity per wire7 dispatch semantics: the dispatched subagent
 * shares the parent root session (the dispatch queue is keyed by it); the
 * dispatch session tag doubles as the child's agent id and own session key.
 */
export function createChildBinding(rootSessionId: string, agentId: string, agentName: string, policy: AdmissionPolicy, parentSessionId = rootSessionId): ChildBinding {
	if (!isAdmissionIdentifier(rootSessionId) || !isAdmissionIdentifier(agentId) || !isAdmissionIdentifier(agentName)) {
		throw new Error("invalid child binding identifiers");
	}
	return Object.freeze({
		version: 1,
		rootSessionId,
		sessionId: agentId,
		agentId,
		kind: "execution-child",
		parentSessionId,
		agentName,
		bootstrapRef: `env:${agentId}`,
		requiredExtensions: Object.freeze(policy.requiredExtensions.map(({ id, path }) => Object.freeze({ id, path }))),
	});
}
