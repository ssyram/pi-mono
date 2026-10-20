import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import { isAdmissionIdentifier } from "../admission/parse-policy-input.ts";
import type { RootBinding } from "./actor-binding.ts";

export function createRootBinding(sessionId: string, policy: AdmissionPolicy): RootBinding {
	// Step P6: root has no child allowlist or parent requirement.
	if (!isAdmissionIdentifier(sessionId)) throw new Error("Invalid root session identifier");
	return Object.freeze({
		version: 1,
		rootSessionId: sessionId,
		sessionId,
		agentId: "main",
		kind: "execution-root",
		parentSessionId: null,
		agentName: null,
		bootstrapRef: null,
		requiredExtensions: Object.freeze(policy.requiredExtensions.map(({ id, path }) => Object.freeze({ id, path }))),
	});
}
