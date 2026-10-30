import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { killScriptGroup } from "../script-tasks/kill-script-group.js";
import {
	CANCELLED_FILE,
	DELIVERED_FILE,
	PID_FILE,
	RESULT_FILE,
	TASK_FILE,
	readJson,
	writeJsonAtomic,
	type CancelledMarker,
	type DeliveredMarker,
	type RunOutcome,
	type RunTaskPayload,
} from "../script-tasks/run-record.js";
import type { ExecutionTarget } from "./model.js";
import {
	failedOutcome,
	scanRuns,
	type RunView,
} from "./run-catalog-state.js";
import { parseOutcome } from "../script-tasks/run-record.js";

export type RunCatalog = {
	startRun(target: ExecutionTarget): RunView;
	scan(): Promise<RunView[]>;
	markDelivered(dir: string, how: DeliveredMarker["how"]): void;
	markCancelled(dir: string, stage: CancelledMarker["stage"]): void;
	cancelRunning(view: RunView): Promise<"cancelled" | "already-finished">;
};

export function createRunCatalog(options: {
	runsRoot: string;
	ownerSessionId: string;
	now?: () => number;
	onForeignTasks?: (taskIds: string[]) => void;
}): RunCatalog {
	const now = options.now ?? Date.now;
	const synthesizeOptions = () => ({
		synthesize: true,
		sessionId: options.ownerSessionId,
		now,
	});
	return {
		startRun(target) {
			const runId = `${now()}-${randomUUID().slice(0, 8)}`;
			const dir = join(options.runsRoot, target.id, runId);
			mkdirSync(dir, { recursive: true });
			const payload: RunTaskPayload =
				target.scriptTask === undefined
					? target.includeTimestamp === true
						? { prompt: target.prompt, includeTimestamp: true }
						: { prompt: target.prompt }
					: target.includeTimestamp === true
						? { scriptTask: target.scriptTask, includeTimestamp: true }
						: { scriptTask: target.scriptTask };
			const record = {
				version: 1 as const,
				taskId: target.id,
				scope: target.scope,
				payload,
				ownerSessionId: options.ownerSessionId,
				startedAt: now(),
			};
			writeJsonAtomic(join(dir, TASK_FILE), record);
			const outcome = platformBlockedOutcome(target, record.payload, now());
			if (outcome !== undefined) {
				writeJsonAtomic(join(dir, RESULT_FILE), outcome);
				return viewOf(record, dir, runId, outcome, "pendingDelivery");
			}
			const wrapperPid = spawnWrapper(dir);
			if (wrapperPid !== undefined)
				writeJsonAtomic(join(dir, PID_FILE), wrapperPid);
			return viewOf(record, dir, runId, undefined, "running");
		},
		async scan() {
			const result = await scanRuns(options.runsRoot, synthesizeOptions());
			if (result.foreignTaskIds.length > 0)
				options.onForeignTasks?.(result.foreignTaskIds);
			return result.views;
		},
		markDelivered(dir, how) {
			const marker: DeliveredMarker = {
				sessionId: options.ownerSessionId,
				deliveredAt: now(),
				how,
			};
			writeJsonAtomic(join(dir, DELIVERED_FILE), marker);
		},
		markCancelled(dir, stage) {
			const marker: CancelledMarker = {
				sessionId: options.ownerSessionId,
				at: now(),
				stage,
			};
			writeJsonAtomic(join(dir, CANCELLED_FILE), marker);
		},
		async cancelRunning(view) {
			const pid = view.status?.pid ?? readWrapperPid(view.dir);
			if (pid !== undefined) {
				try {
					process.kill(pid, "SIGTERM");
				} catch {
					/* Already dead; the wait below observes the result file. */
				}
			}
			// E21: only a cancelled result confirms the stop; a wrapper that merely
			// finished leaves the run for the caller's retraction pass.
			if (await waitForCancelled(join(view.dir, RESULT_FILE), 3000))
				return "cancelled";
			if (pid !== undefined) killScriptGroup(pid);
			const scriptPid = view.status?.scriptPid;
			if (scriptPid !== undefined) killScriptGroup(scriptPid);
			if (await waitForCancelled(join(view.dir, RESULT_FILE), 1500))
				return "cancelled";
			// Wrapper died before writing a result (SIGTERM raced its handler install):
			// re-read once — it may have written a real result before dying.
			const late = parseOutcome(readJson(join(view.dir, RESULT_FILE)));
			if (late !== undefined) return "already-finished";
			const cancelled: RunOutcome = {
				cancelled: true,
				results: [],
				successCount: 0,
				shouldWake: false,
				completedAt: now(),
				content: "Cancelled before completion.",
			};
			writeJsonAtomic(join(view.dir, RESULT_FILE), cancelled);
			return "cancelled";
		},
	};
}

function spawnWrapper(dir: string): number | undefined {
	const pluginRoot = dirname(
		dirname(dirname(fileURLToPath(import.meta.url))),
	);
	const loader = join(pluginRoot, "node_modules", "tsx", "dist", "loader.mjs");
	const entry = join(pluginRoot, "src", "script-tasks", "runner-main.ts");
	try {
		const child = spawn(
			process.execPath,
			["--import", loader, entry, dir],
			{ detached: true, stdio: "ignore" },
		);
		child.unref();
		return child.pid;
	} catch {
		return undefined;
	}
}

function readWrapperPid(dir: string): number | undefined {
	const raw = readJson(join(dir, PID_FILE));
	return typeof raw === "number" && Number.isInteger(raw) ? raw : undefined;
}

function platformBlockedOutcome(
	target: ExecutionTarget,
	payload: RunTaskPayload,
	now: number,
): RunOutcome | undefined {
	if (process.platform !== "win32") return undefined;
	return failedOutcome(
		{
			version: 1,
			taskId: target.id,
			scope: target.scope,
			payload,
			ownerSessionId: "",
			startedAt: now,
		},
		undefined,
		"POSIX process groups are required.",
		now,
	);
}

function viewOf(
	record: RunView["record"],
	dir: string,
	runId: string,
	outcome: RunOutcome | undefined,
	state: RunView["state"],
): RunView {
	return {
		taskId: record.taskId,
		runId,
		dir,
		startedAt: record.startedAt,
		record,
		status: undefined,
		outcome,
		state,
	};
}

async function waitForCancelled(
	path: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const outcome = parseOutcome(readJson(path));
		if (outcome?.cancelled === true) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
