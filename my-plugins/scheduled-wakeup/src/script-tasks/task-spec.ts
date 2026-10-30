export const DEFAULT_SCRIPT_TIMEOUT_SECONDS = 1800;

export type WakeUpSetting =
	| { kind: "never" }
	| { kind: "always"; prompt: string }
	| { kind: "on-error"; aggregation: "and" | "or"; prompt: string };

export type ScriptSpec = {
	cwd: string;
	path: string;
	params: readonly string[];
	timeoutSeconds: number | null;
};

export type ScriptTask = {
	wakeUp: WakeUpSetting;
	scripts: readonly ScriptSpec[];
};

export type PreparationResult =
	| { ok: true; task: ScriptTask }
	| { ok: false; error: string };

export type ScriptResult = {
	script: ScriptSpec;
	status: "success" | "failed" | "timeout" | "start-failed" | "cancelled";
	exitCode: number | null;
	signal: string | null;
	stdout: string;
	stderr: string;
	stdoutLog?: string;
	stderrLog?: string;
	error: string | null;
};

export type RunnerOptions = {
	abortSignal?: AbortSignal;
	logDir?: string;
	index?: number;
	onSpawn?: (pid: number | undefined) => void;
};

export type ScriptRunner = (
	script: ScriptSpec,
	options?: RunnerOptions,
) => Promise<ScriptResult>;

export type TaskRun = {
	wakeUpId: string;
	results: readonly ScriptResult[];
	successCount: number;
	shouldWake: boolean;
	completedAt: number;
	content: string;
};

export function scriptStartFailure(
	script: ScriptSpec,
	error: string,
): ScriptResult {
	return {
		script,
		status: "start-failed",
		exitCode: null,
		signal: null,
		stdout: "",
		stderr: "",
		error,
	};
}
