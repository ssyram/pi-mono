import { basename, isAbsolute } from "node:path";
import { prepareScriptTask } from "../script-tasks/prepare-task.js";
import type { ScriptTask } from "../script-tasks/task-spec.js";

export type TaskContent =
	| { prompt: string; scriptTask?: never }
	| { scriptTask: ScriptTask; prompt?: never };

export function readTaskContent(
	value: Record<string, unknown>,
): TaskContent | undefined {
	if (Object.hasOwn(value, "scriptTask")) {
		if (Object.hasOwn(value, "prompt")) return undefined;
		const prepared = prepareScriptTask(value.scriptTask, "/");
		if (!prepared.ok) return undefined;
		const raw = value.scriptTask as { scripts: Record<string, unknown>[] };
		if (
			raw.scripts.some(
				(script) =>
					typeof script.cwd !== "string" ||
					!isAbsolute(script.cwd) ||
					typeof script.path !== "string" ||
					!isAbsolute(script.path),
			)
		)
			return undefined;
		return { scriptTask: prepared.task };
	}
	return typeof value.prompt === "string" && value.prompt.trim().length > 0
		? { prompt: value.prompt }
		: undefined;
}

export function cloneTaskContent(value: TaskContent): TaskContent {
	if (value.scriptTask === undefined) return { prompt: value.prompt };
	return {
		scriptTask: {
			wakeUp: { ...value.scriptTask.wakeUp },
			scripts: value.scriptTask.scripts.map((script) => ({
				...script,
				params: [...script.params],
			})),
		},
	};
}

const PROMPT_SUMMARY_MAX_CHARS = 80;

export function describeTaskContent(value: TaskContent): string {
	if (value.scriptTask === undefined) return summarizePrompt(value.prompt);
	const { wakeUp, scripts } = value.scriptTask;
	if (wakeUp.kind !== "never") return summarizePrompt(wakeUp.prompt);
	const first = basename(scripts[0]?.path ?? "");
	return scripts.length > 1
		? `运行 ${first} 等 ${scripts.length} 个脚本`
		: `运行 ${first}`;
}

function summarizePrompt(prompt: string): string {
	const line =
		prompt.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
	const trimmed = line.trim();
	return trimmed.length > PROMPT_SUMMARY_MAX_CHARS
		? `${trimmed.slice(0, PROMPT_SUMMARY_MAX_CHARS)}...`
		: trimmed;
}
