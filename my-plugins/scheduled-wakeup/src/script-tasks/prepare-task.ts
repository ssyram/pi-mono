import { homedir } from "node:os";
import { resolveUserPath } from "../../../file-path/resolve-user-path.js";
import {
	DEFAULT_SCRIPT_TIMEOUT_SECONDS,
	type PreparationResult,
	type ScriptSpec,
	type WakeUpSetting,
} from "./task-spec.js";

export function prepareScriptTask(
	input: unknown,
	baseCwd: string,
	home: string = homedir(),
): PreparationResult {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ok: false, error: "Task must be an object." };
	}
	const record = input as Record<string, unknown>;
	if (!Array.isArray(record.scripts))
		return { ok: false, error: "scripts must be an array." };
	if (
		typeof record.wakeUp !== "object" ||
		record.wakeUp === null ||
		Array.isArray(record.wakeUp)
	) {
		return { ok: false, error: "wakeUp must be an object." };
	}
	const setting = record.wakeUp as Record<string, unknown>;
	let wakeUp: WakeUpSetting;
	if (setting.kind === "never") wakeUp = { kind: "never" };
	else {
		if (setting.kind !== "always" && setting.kind !== "on-error") {
			return { ok: false, error: "Unknown wakeUp kind." };
		}
		if (typeof setting.prompt !== "string")
			return { ok: false, error: "prompt must be a string." };
		if (setting.kind === "always")
			wakeUp = { kind: "always", prompt: setting.prompt };
		else {
			const aggregation =
				setting.aggregation === undefined ? "or" : setting.aggregation;
			if (aggregation !== "and" && aggregation !== "or") {
				return { ok: false, error: "aggregation must be and or or." };
			}
			wakeUp = { kind: "on-error", aggregation, prompt: setting.prompt };
		}
	}
	if (record.scripts.length === 0 && wakeUp.kind !== "always") {
		return {
			ok: false,
			error: "A task without scripts requires always wakeUp.",
		};
	}
	const scripts: ScriptSpec[] = [];
	for (const inputScript of record.scripts) {
		const prepared = prepareScript(inputScript, baseCwd, home);
		if (!prepared.ok) return prepared;
		scripts.push(prepared.script);
	}
	return { ok: true, task: { wakeUp, scripts } };
}

function prepareScript(
	input: unknown,
	baseCwd: string,
	home: string,
): { ok: true; script: ScriptSpec } | { ok: false; error: string } {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ok: false, error: "Script must be an object." };
	}
	const record = input as Record<string, unknown>;
	if (typeof record.path !== "string" || record.path.length === 0) {
		return { ok: false, error: "Script path must be a non-empty string." };
	}
	const cwd = record.cwd === undefined ? "." : record.cwd;
	if (typeof cwd !== "string" || cwd.length === 0)
		return { ok: false, error: "cwd must be a non-empty string." };
	const params = record.params === undefined ? [] : record.params;
	if (
		!Array.isArray(params) ||
		params.some((param) => typeof param !== "string")
	) {
		return { ok: false, error: "params must be an array of strings." };
	}
	const timeoutSeconds =
		record.timeoutSeconds === undefined
			? DEFAULT_SCRIPT_TIMEOUT_SECONDS
			: record.timeoutSeconds;
	if (
		timeoutSeconds !== null &&
		(typeof timeoutSeconds !== "number" ||
			!Number.isFinite(timeoutSeconds) ||
			timeoutSeconds <= 0 ||
			timeoutSeconds * 1000 > Number.MAX_SAFE_INTEGER)
	) {
		return {
			ok: false,
			error: "timeoutSeconds must be positive finite seconds or null.",
		};
	}
	const resolvedCwd = resolveUserPath(cwd, baseCwd, home);
	return {
		ok: true,
		script: {
			cwd: resolvedCwd,
			path: resolveUserPath(record.path, resolvedCwd, home),
			params: [...params],
			timeoutSeconds,
		},
	};
}
