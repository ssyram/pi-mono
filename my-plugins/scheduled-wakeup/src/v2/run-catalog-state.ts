import { rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { liveSocketPath, probeLiveSocket } from "../script-tasks/live-socket.js";
import { buildWakeUpContent } from "../script-tasks/wake-up-content.js";
import { shouldWakeUp } from "../script-tasks/wake-up-policy.js";
import type { ScriptSpec } from "../script-tasks/task-spec.js";
import {
	CANCELLED_FILE,
	DELIVERED_FILE,
	RESULT_FILE,
	STATUS_FILE,
	TASK_FILE,
	parseCancelled,
	parseDelivered,
	parseOutcome,
	parseStatus,
	parseTaskRecord,
	readJson,
	type RunOutcome,
	type RunStatus,
	type RunTaskRecord,
	writeJsonAtomic,
} from "../script-tasks/run-record.js";
export const START_GRACE_MS = 30_000;
export const KEEP_PER_TASK = 5;
export const KEEP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type RunState = "running" | "pendingDelivery" | "done" | "cancelled" | "lost";

export type RunView = {
	taskId: string;
	runId: string;
	dir: string;
	startedAt: number;
	record: RunTaskRecord;
	status: RunStatus | undefined;
	outcome: RunOutcome | undefined;
	state: RunState;
};

export type ScanOptions = {
	synthesize: boolean;
	sessionId: string;
	now: () => number;
};

/** Classifies every run directory; the owner session also repairs lost/stale runs and GCs terminals. */
export type ScanResult = {
	views: RunView[];
	foreignActive: number;
	foreignTaskIds: string[];
};

export async function scanRuns(
	runsRoot: string,
	options: ScanOptions,
): Promise<ScanResult> {
	// Ownership is sessionId equality, full stop: a forked session (new id)
	// disconnects from every run it did not register — no display, delivery,
	// synthesis, stop, or GC. Dead-owner runs wait on disk for their owner.
	const views: RunView[] = [];
	const foreign: RunView[] = [];
	const tasks = await readDir(join(runsRoot));
	for (const taskId of tasks) {
		const runIds = await readDir(join(runsRoot, taskId));
		const taskViews: RunView[] = [];
		for (const runId of runIds) {
			const view = await classify(
				join(runsRoot, taskId, runId),
				taskId,
				runId,
				options,
			);
			if (view === undefined) continue;
			if (view.record.ownerSessionId !== options.sessionId) {
				// Foreign run: never touched on disk. Reported upstream so a real
				// fork can cancel the task locally and stop tracking it.
				foreign.push(view);
				continue;
			}
			taskViews.push(view);
			views.push(view);
		}
		if (options.synthesize) gcTask(taskViews, options);
	}
	const foreignActive = foreign.filter(
		(view) => view.state === "running" || view.state === "pendingDelivery",
	);
	return {
		views,
		foreignActive: foreignActive.length,
		foreignTaskIds: [...new Set(foreignActive.map((view) => view.taskId))],
	};
}

async function classify(
	dir: string,
	taskId: string,
	runId: string,
	options: ScanOptions,
): Promise<RunView | undefined> {
	const record = parseTaskRecord(readJson(join(dir, TASK_FILE)));
	if (record === undefined) return undefined;
	const outcome = parseOutcome(readJson(join(dir, RESULT_FILE)));
	const status = parseStatus(readJson(join(dir, STATUS_FILE)));
	const cancelled = parseCancelled(readJson(join(dir, CANCELLED_FILE)));
	const delivered = parseDelivered(readJson(join(dir, DELIVERED_FILE)));
	const view: RunView = {
		taskId,
		runId,
		dir,
		startedAt: record.startedAt,
		record,
		status,
		outcome,
		state: "running",
	};
	if (cancelled !== undefined || outcome?.cancelled === true) {
		view.state = "cancelled";
		return view;
	}
	if (delivered !== undefined) {
		view.state = "done";
		return view;
	}
	if (outcome !== undefined) {
		view.state = "pendingDelivery";
		return view;
	}
	const alive =
		status === undefined
			? options.now() - record.startedAt < START_GRACE_MS
			: await probeLiveSocket(liveSocketPath(dir));
	if (alive) {
		view.state = "running";
		return view;
	}
	const lateOutcome = parseOutcome(readJson(join(dir, RESULT_FILE)));
	if (lateOutcome !== undefined) {
		view.outcome = lateOutcome;
		view.state = lateOutcome.cancelled ? "cancelled" : "pendingDelivery";
		return view;
	}
	view.state = "lost";
	if (options.synthesize && record.ownerSessionId === options.sessionId) {
		// Compact migration changes sessionId, so any scanning session must repair:
		// markers make repeated synthesis idempotent.
		view.outcome = failedOutcome(
			record,
			status,
			status === undefined ? "runner never started" : "runner lost",
			options.now(),
			status === undefined ? "start-failed" : "failed",
		);
		writeJsonAtomic(join(dir, RESULT_FILE), view.outcome);
		view.state = "pendingDelivery";
	}
	return view;
}

export function failedOutcome(
	record: RunTaskRecord,
	status: RunStatus | undefined,
	error: string,
	now: number,
	kind: "failed" | "start-failed" = "failed",
): RunOutcome {
	const scripts = record.payload.scriptTask?.scripts ?? [];
	const script: ScriptSpec | undefined = scripts[status?.currentIndex ?? 0];
	const results =
		script === undefined
			? []
			: [
					{
						script,
						status: kind,
						exitCode: null,
						signal: null,
						stdout: "",
						stderr: "",
						error,
					},
				];
	const task = record.payload.scriptTask;
	const shouldWake =
		task === undefined ? true : shouldWakeUp(task.wakeUp, results);
	const content =
		task === undefined
			? error
			: buildWakeUpContent(
					task,
					results,
					shouldWake,
					record.payload.includeTimestamp === true
						? { completedAt: now, sentAt: now }
						: undefined,
				);
	return { cancelled: false, results, successCount: 0, shouldWake, completedAt: now, content };
}

function gcTask(views: RunView[], options: ScanOptions): void {
	const terminal = views
		.filter((view) => view.state === "done" || view.state === "cancelled")
		.sort((a, b) => b.startedAt - a.startedAt);
	const now = options.now();
	for (const view of terminal.slice(KEEP_PER_TASK)) {
		if (now - view.startedAt <= KEEP_AGE_MS) continue;
		try {
			rmSync(view.dir, { recursive: true, force: true });
		} catch {
			/* GC failure is diagnostic-only. */
		}
	}
}

async function readDir(path: string): Promise<string[]> {
	try {
		return (await readdir(path, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}
