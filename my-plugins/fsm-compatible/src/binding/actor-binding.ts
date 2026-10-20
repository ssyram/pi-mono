import type { AdmissionPolicy, RequiredExtensionInput } from "../admission/admission-policy.ts";

export interface BindingIdentity {
	readonly version: 1;
	readonly rootSessionId: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly requiredExtensions: readonly RequiredExtensionInput[];
}

export interface RootBinding extends BindingIdentity {
	readonly kind: "execution-root";
	readonly parentSessionId: null;
	readonly agentName: null;
	readonly bootstrapRef: null;
}

export interface ChildBinding extends BindingIdentity {
	readonly kind: "execution-child";
	readonly parentSessionId: string;
	readonly agentName: string;
	readonly bootstrapRef: string;
}

export type PersistedBinding = RootBinding | ChildBinding;
export const BINDING_CUSTOM_TYPE = "fsm-compatible:binding";

export interface BindingRecord {
	readonly binding: PersistedBinding;
}

export interface BindingRecords {
	find(sessionId: string): BindingRecord | undefined;
}

export interface AuthenticatedCaller {
	readonly rootSessionId: string;
	readonly sessionId: string;
}

export interface PendingLaunch {
	readonly rootSessionId: string;
	readonly callerSessionId: string;
	readonly agentName: string;
	readonly bootstrapRef: string;
	readonly policy: AdmissionPolicy;
	state: "allocated" | "registered" | "acquired" | "failed" | "cancelled";
	registeredSessionId: string | null;
}

export interface BindingEntry {
	readonly type: string;
	readonly customType?: string;
	readonly data?: unknown;
}
