import type { AuthenticatedCaller, BindingRecords, PersistedBinding } from "../binding/actor-binding.ts";
import { parentDepth } from "../binding/parent-chain.ts";
import { restoreActorBinding } from "../binding/restore-actor-binding.ts";
import type { AdmissionPolicy, LaunchRequest, RequiredExtension } from "./admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "./admission-result.ts";
import { isAdmissionIdentifier, isAdmissionObject } from "./parse-policy-input.ts";

export interface ChildToolLoadout {
	readonly availableToolNames: readonly string[];
	readonly requiredToolNames: readonly string[];
}

export interface ResumeAdmission {
	readonly saved: PersistedBinding;
	readonly actualSessionId: string;
}

export interface AdmittedChildLaunch {
	readonly rootSessionId: string;
	readonly callerSessionId: string;
	readonly agentName: string;
	readonly runtimeName: string;
	readonly bootstrapRef: null;
	readonly executionMode: "sync" | "async";
	readonly resumeSessionFile: string | null;
	readonly requiredExtensions: readonly RequiredExtension[];
	readonly allowedToolNames: readonly string[];
}

export function admitChildLaunch(
	policy: AdmissionPolicy,
	caller: AuthenticatedCaller,
	value: unknown,
	records: BindingRecords,
	tools: ChildToolLoadout,
	resume?: ResumeAdmission,
): AdmissionResult<AdmittedChildLaunch> {
	// Step P5: request fields cannot carry identity, policy, or an internal bypass.
	if (!isAdmissionObject(value) || Object.keys(value).some((key) => !["agentName", "executionMode", "resumeSessionFile"].includes(key))) {
		return rejected("invalid-input");
	}
	if (!isAdmissionIdentifier(value.agentName) || (value.executionMode !== "sync" && value.executionMode !== "async")
		|| ("resumeSessionFile" in value && !isAdmissionIdentifier(value.resumeSessionFile))) return rejected("invalid-input");
	const request: LaunchRequest = {
		agentName: value.agentName,
		executionMode: value.executionMode,
		...(typeof value.resumeSessionFile === "string" ? { resumeSessionFile: value.resumeSessionFile } : {}),
	};
	const depth = parentDepth(caller.rootSessionId, caller.sessionId, records);
	if (!depth.ok) return depth;
	if (depth.value >= policy.maxDepth) return rejected("depth-exceeded");
	const agent = policy.agents.find((item) => item.canonicalName === request.agentName);
	if (!agent) return rejected("agent-not-admitted");
	if (agent.runnerType !== "pi" || agent.machine !== undefined) return rejected("runner-not-admitted");
	if (tools.requiredToolNames.some((name) => !tools.availableToolNames.includes(name))) return rejected("invalid-input");
	if (agent.declaredToolCeiling !== null && tools.requiredToolNames.some((name) => !agent.declaredToolCeiling?.includes(name))) {
		return rejected("policy-widened");
	}
	if (request.resumeSessionFile !== undefined) {
		if (!resume || resume.saved.kind !== "execution-child" || resume.saved.agentName !== agent.canonicalName) return rejected("restore-conflict");
		const restored = restoreActorBinding(policy, resume.saved, resume.actualSessionId, caller.rootSessionId, records);
		if (!restored.ok) return restored;
	} else if (resume) {
		return rejected("invalid-input");
	}
	const allowedToolNames = tools.availableToolNames.filter((name) => agent.declaredToolCeiling === null || agent.declaredToolCeiling.includes(name));
	return admitted(Object.freeze({
		rootSessionId: caller.rootSessionId,
		callerSessionId: caller.sessionId,
		agentName: agent.canonicalName,
		runtimeName: agent.runtimeName,
		bootstrapRef: null,
		executionMode: request.executionMode,
		resumeSessionFile: request.resumeSessionFile ?? null,
		requiredExtensions: Object.freeze(policy.requiredExtensions.map((item) => Object.freeze({ ...item }))),
		allowedToolNames: Object.freeze([...new Set(allowedToolNames)]),
	}));
}
