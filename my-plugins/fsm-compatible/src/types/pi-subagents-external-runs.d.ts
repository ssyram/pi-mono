// Ambient declaration for the optional pi-subagents integration: the package
// exists only in hosts that installed it; the runtime import is dynamic and
// this file only provides compile-time types.
declare module "pi-subagents/external-runs" {
	export type ExternalRunState = "queued" | "running" | "completed" | "failed" | "stopped";
	export interface ExternalRun {
		id: string;
		sessionId: string;
		source: string;
		label: string;
		state: ExternalRunState;
		startedAt: number;
		updatedAt?: number | undefined;
		endedAt?: number | undefined;
		currentAction?: string | undefined;
		preview?: string | undefined;
		reportPath?: string | undefined;
		transcriptPath?: string | undefined;
	}
	export function registerExternalRun(input: ExternalRun): ExternalRun;
	export function updateExternalRun(sessionId: string, id: string, update: Partial<Omit<ExternalRun, "id" | "sessionId" | "source">>): ExternalRun;
	export function unregisterExternalRun(sessionId: string, id: string): boolean;
}
