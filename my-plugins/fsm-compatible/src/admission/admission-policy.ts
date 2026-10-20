export const FSM_COMPATIBLE_EXTENSION_ID = "fsm-compatible";
export const MAX_REQUIRED_EXTENSIONS = 32;
export const REQUIRED_EXTENSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface RequiredExtensionInput {
	readonly id: string;
	readonly path: string;
}

export interface RequiredExtension extends RequiredExtensionInput {
	readonly requireForAllRunners: true;
}

export interface PolicyInput {
	readonly allowedAgentNames: readonly string[];
	readonly requiredExtensions: readonly RequiredExtensionInput[];
	readonly maxDepth: number;
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
	readonly [key: string]: JsonValue;
}

export interface ResolvedAgent {
	readonly canonicalName: string;
	readonly runtimeName: string;
	readonly runnerType?: string;
	readonly machine?: string;
	readonly definitionSnapshot: JsonObject;
	readonly declaredToolCeiling: readonly string[] | null;
}

export interface AdmissionPolicy {
	readonly agents: readonly ResolvedAgent[];
	readonly requiredExtensions: readonly RequiredExtension[];
	readonly maxDepth: number;
}

export interface LaunchRequest {
	readonly agentName: string;
	readonly executionMode: "sync" | "async";
	readonly resumeSessionFile?: string;
}
