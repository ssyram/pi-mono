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
	status: "success" | "failed" | "timeout" | "start-failed";
	exitCode: number | null;
	signal: string | null;
	stdout: string;
	stderr: string;
	error: string | null;
};

export type ScriptRunner = (script: ScriptSpec) => Promise<ScriptResult>;

export type TaskRun = {
	wakeUpId: string;
	results: readonly ScriptResult[];
	successCount: number;
	shouldWake: boolean;
	completedAt: number;
	content: string;
};
