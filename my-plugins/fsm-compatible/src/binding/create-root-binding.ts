import { createHash } from "node:crypto";
import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import { isAdmissionIdentifier } from "../admission/parse-policy-input.ts";
import type { RootBinding } from "./actor-binding.ts";

// HC addresses every FSM-visible session with a ses_-prefixed id; the Pi host
// id is a UUID. Derived deterministically so a restarted root session presents
// the same FSM identity without extra persisted state.
export function protocolSessionId(sessionId: string): string {
	return `ses_${createHash("sha256").update(sessionId).digest("hex").slice(0, 24)}`;
}

export function createRootBinding(sessionId: string, policy: AdmissionPolicy): RootBinding {
	// Step P6: root has no child allowlist or parent requirement.
	if (!isAdmissionIdentifier(sessionId)) throw new Error("Invalid root session identifier");
	return Object.freeze({
		version: 1,
		rootSessionId: protocolSessionId(sessionId),
		sessionId,
		agentId: "main",
		kind: "execution-root",
		parentSessionId: null,
		agentName: null,
		bootstrapRef: null,
		requiredExtensions: Object.freeze(policy.requiredExtensions.map(({ id, path }) => Object.freeze({ id, path }))),
	});
}
