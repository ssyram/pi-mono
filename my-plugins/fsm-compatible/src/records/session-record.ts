import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";

export type SessionLifecycle = "starting" | "running" | "settling" | "retrying" | "idle" | "failed" | "aborted" | "unavailable";

export interface RecordFacts {
	readonly title: string;
	readonly lifecycle: SessionLifecycle;
	readonly updatedAt: number;
	readonly header: SessionHeader | null;
	readonly branch: readonly SessionEntry[];
	readonly sessionFile: string | null;
	readonly errorMessage: string | null;
}

export interface ExecutionRecord extends RecordFacts {
	readonly sessionId: string;
	readonly parentSessionId: string | null;
	readonly agentId: string;
	readonly agentName: string | null;
	readonly rootSessionId: string;
}

export interface JudgeRecord {
	readonly sessionId: string;
	readonly title: string;
	readonly createdAt: number;
	updatedAt: number;
	readonly sessionFile: string | null;
	lifecycle: "busy" | "idle" | "unavailable";
}
