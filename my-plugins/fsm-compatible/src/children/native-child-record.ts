import type { ChildBinding } from "../binding/actor-binding.ts";
import type { SessionLifecycle } from "../records/session-record.ts";

export const NATIVE_THINKING_LEVELS: readonly string[] = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface NativeChildRecord {
	readonly binding: ChildBinding;
	readonly token: string;
	readonly cwd: string;
	readonly directory: string;
	readonly sessionFile: string;
	readonly bundle: string;
	readonly configFile: string;
	readonly model: string;
	readonly thinking: string;
	readonly name: string | null;
	readonly depth: number;
	readonly extraArgs: readonly string[];
	readonly tmuxSession: string;
	startController: AbortController | undefined;
	startupError: boolean;
	lifecycle: SessionLifecycle;
	outcome: string | null;
	summary: string;
	ready: { resolve(): void; reject(error: Error): void } | undefined;
	runActive: boolean;
}
