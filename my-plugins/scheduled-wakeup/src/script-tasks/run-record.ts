import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScriptResult, ScriptTask } from "./task-spec.js";

export const TASK_FILE = "task.json";
export const STATUS_FILE = "status.json";
export const RESULT_FILE = "result.json";
export const DELIVERED_FILE = "delivered.json";
export const CANCELLED_FILE = "cancelled.json";
export const LIVE_SOCK = "live.sock";
export const OUTPUT_DIR = "output";
export const PID_FILE = "wrapper.pid";

export type RunScope = "session" | "workspace" | "global";

export type RunTaskPayload = { includeTimestamp?: boolean } & (
	| { prompt: string; scriptTask?: never }
	| { scriptTask: ScriptTask; prompt?: never }
);

export type RunTaskRecord = {
	version: 1;
	taskId: string;
	scope: RunScope;
	payload: RunTaskPayload;
	ownerSessionId: string;
	startedAt: number;
};

export type RunStatus = {
	pid: number;
	scriptPid?: number;
	currentIndex: number;
	success: number;
	completed: number;
	total: number;
	updatedAt: number;
};

export type RunOutcome = {
	cancelled: boolean;
	results: ScriptResult[];
	successCount: number;
	shouldWake: boolean;
	completedAt: number;
	content: string;
};

export type DeliveredMarker = {
	sessionId: string;
	deliveredAt: number;
	how: "idle-send" | "boundary-entries";
};

export type CancelledMarker = {
	sessionId: string;
	at: number;
	stage: "running" | "pendingDelivery";
};

export function writeJsonAtomic(path: string, value: unknown): void {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		renameSync(temporary, path);
	} catch (error) {
		try {
			rmSync(temporary, { force: true });
		} catch {
			/* Preserve the primary write failure if cleanup is also denied. */
		}
		throw error;
	}
}

export function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

export function parseTaskRecord(data: unknown): RunTaskRecord | undefined {
	if (!isRecord(data) || data.version !== 1) return undefined;
	const taskId = text(data.taskId);
	const scope = scopeOf(data.scope);
	const ownerSessionId = text(data.ownerSessionId);
	const startedAt = timestamp(data.startedAt);
	if (
		taskId === undefined ||
		scope === undefined ||
		ownerSessionId === undefined ||
		startedAt === undefined
	)
		return undefined;
	const payload = parsePayload(data.payload);
	if (payload === undefined) return undefined;
	return { version: 1, taskId, scope, payload, ownerSessionId, startedAt };
}

export function parseStatus(data: unknown): RunStatus | undefined {
	if (!isRecord(data)) return undefined;
	const pid = count(data.pid);
	const rawScriptPid = data.scriptPid;
	const scriptPid =
		rawScriptPid === undefined ? undefined : count(rawScriptPid);
	const currentIndex = count(data.currentIndex);
	const success = count(data.success);
	const completed = count(data.completed);
	const total = count(data.total);
	const updatedAt = timestamp(data.updatedAt);
	if (
		pid === undefined ||
		(rawScriptPid !== undefined && scriptPid === undefined) ||
		currentIndex === undefined ||
		success === undefined ||
		completed === undefined ||
		total === undefined ||
		updatedAt === undefined
	)
		return undefined;
	return {
		pid,
		...(scriptPid === undefined ? {} : { scriptPid }),
		currentIndex,
		success,
		completed,
		total,
		updatedAt,
	};
}

export function parseOutcome(data: unknown): RunOutcome | undefined {
	if (!isRecord(data) || typeof data.cancelled !== "boolean") return undefined;
	const results =
		Array.isArray(data.results) && data.results.every(isScriptResult)
			? (data.results as ScriptResult[])
			: undefined;
	const successCount = count(data.successCount);
	const shouldWake = data.cancelled === true ? false : booleanOf(data.shouldWake);
	const completedAt = timestamp(data.completedAt);
	const content = text(data.content);
	if (
		results === undefined ||
		successCount === undefined ||
		shouldWake === undefined ||
		completedAt === undefined ||
		content === undefined
	)
		return undefined;
	return {
		cancelled: data.cancelled,
		results,
		successCount,
		shouldWake,
		completedAt,
		content,
	};
}

export function parseDelivered(data: unknown): DeliveredMarker | undefined {
	if (!isRecord(data)) return undefined;
	const sessionId = text(data.sessionId);
	const deliveredAt = timestamp(data.deliveredAt);
	const how = data.how;
	if (
		sessionId === undefined ||
		deliveredAt === undefined ||
		(how !== "idle-send" && how !== "boundary-entries")
	)
		return undefined;
	return { sessionId, deliveredAt, how };
}

export function parseCancelled(data: unknown): CancelledMarker | undefined {
	if (!isRecord(data)) return undefined;
	const sessionId = text(data.sessionId);
	const at = timestamp(data.at);
	const stage = data.stage;
	if (
		sessionId === undefined ||
		at === undefined ||
		(stage !== "running" && stage !== "pendingDelivery")
	)
		return undefined;
	return { sessionId, at, stage };
}

export function runDirPath(runsRoot: string, taskId: string, runId: string): string {
	return join(runsRoot, taskId, runId);
}

function parsePayload(data: unknown): RunTaskPayload | undefined {
	if (!isRecord(data)) return undefined;
	const includeTimestamp =
		data.includeTimestamp === undefined
			? {}
			: { includeTimestamp: data.includeTimestamp === true };
	if (typeof data.prompt === "string") return { prompt: data.prompt, ...includeTimestamp };
	if (isRecord(data.scriptTask) && isWakeUp(data.scriptTask.wakeUp)) {
		const scripts = Array.isArray(data.scriptTask.scripts)
			? data.scriptTask.scripts.filter(isScriptSpec)
			: undefined;
		if (scripts === undefined) return undefined;
		return { scriptTask: { wakeUp: data.scriptTask.wakeUp, scripts }, ...includeTimestamp };
	}
	return undefined;
}

function isWakeUp(value: unknown): value is ScriptTask["wakeUp"] {
	if (!isRecord(value)) return false;
	if (value.kind === "never") return true;
	if (value.kind === "always") return typeof value.prompt === "string";
	if (value.kind !== "on-error") return false;
	return (
		typeof value.prompt === "string" &&
		(value.aggregation === undefined ||
			value.aggregation === "and" ||
			value.aggregation === "or")
	);
}

function isScriptSpec(data: unknown): data is ScriptTask["scripts"][number] {
	if (!isRecord(data)) return false;
	return (
		text(data.cwd) !== undefined &&
		text(data.path) !== undefined &&
		Array.isArray(data.params) &&
		data.params.every((param) => typeof param === "string") &&
		(data.timeoutSeconds === null ||
			(typeof data.timeoutSeconds === "number" &&
				Number.isFinite(data.timeoutSeconds) &&
				data.timeoutSeconds > 0))
	);
}

const SCRIPT_STATUSES = new Set([
	"success",
	"failed",
	"timeout",
	"start-failed",
	"cancelled",
]);

function isScriptResult(data: unknown): data is ScriptResult {
	if (!isRecord(data) || !isScriptSpec(data.script)) return false;
	return (
		SCRIPT_STATUSES.has(String(data.status)) &&
		(data.exitCode === null || count(data.exitCode) !== undefined) &&
		(data.signal === null || typeof data.signal === "string") &&
		typeof data.stdout === "string" &&
		typeof data.stderr === "string" &&
		(data.error === null || typeof data.error === "string")
	);
}

function scopeOf(value: unknown): RunScope | undefined {
	return value === "session" || value === "workspace" || value === "global"
		? value
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: undefined;
}

function timestamp(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

function booleanOf(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}
