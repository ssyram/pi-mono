import { join } from "node:path";
import { notifyLoop } from "./loop-notification.js";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ScriptSpec } from "./script-tasks/task-spec.js";
import { parseOutcome, parseStatus } from "./script-tasks/run-record.js";
import { isRunnerEnabled } from "./runner-mode.js";
import {
	createRunWatcher,
	type RunWatcher,
	type WatchedRun,
} from "./run-watch/run-watcher.js";
import {
	createDeliveryCoordinator,
	type DeliveryCoordinator,
} from "./v2/delivery-coordinator.js";
import { createRunCatalog, type RunCatalog } from "./v2/run-catalog.js";
import type { RunView } from "./v2/run-catalog-state.js";
import type { ExecutionTarget } from "./v2/model.js";
import { DEFAULT_GC_CRITERIA_MS } from "./v2/run-catalog-state.js";
import { describeGcCriteria } from "./v2/gc-criteria.js";

export type RunningTask = {
	id: string;
	wakeUpId: string;
	startedAt: number;
	/** Wedged-escape budget in ms; undefined means unlimited (null timeout). */
	budgetMs?: number | undefined;
	success: number;
	completed: number;
	total: number;
	current?: ScriptSpec | undefined;
};

/** Thrown by dispatch() when the task's previous run is still active;
 * executors map it to a benign ExecutionResult instead of a failure. */
export class LoopTaskActiveError extends Error {
	constructor(taskId: string) {
		super(`Loop task ${taskId} is already running`);
	}
}

export type DeliveryStatus = { wakeUps: number; noWakes: number };

export type TaskDispatcher = {
	dispatch(target: ExecutionTarget): void;
	list(): readonly RunningTask[];
	liveRuns(): readonly RunView[];
	deliveryStatus(): ReadonlyMap<string, DeliveryStatus>;
	retractPending(taskId: string): number;
	isStarting(taskId: string): boolean;
	requestRunTermination(taskId: string): { signalled: number; retracted: number };
	cancelRun(view: RunView): Promise<"cancelled" | "already-finished">;
	terminateTaskRuns(taskId: string): Promise<RunTermination>;
	runsOverview(): string[];
	/** One GC pass with the configured criteria. */
	garbageCollect(): Promise<{ deleted: number; label: string }>;
	refresh(): Promise<void>;
	dispose(): void;
};

export type RunTermination = { killed: number; retracted: number };

const TICK_MS = 1000;

/** Per-run data the worker does not carry; captured at watch time. */
type RunMeta = {
	scope: RunView["record"]["scope"];
	payload: import("./script-tasks/run-record.js").RunTaskPayload;
	budgetMs: number | undefined;
};

export function createTaskDispatcher(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: {
		onChange(): void;
		onSettled(): void;
		catalog?: RunCatalog;
		watcher?: RunWatcher;
		intervalMs?: number;
		gcCriteriaMs?: number;
		loadGcCriteria?: () => Promise<{ criteriaMs: number; label: string }>;
		onForeignTasks?: (taskIds: string[]) => void;
	},
): TaskDispatcher {
	let foreignNotified = false;
	const onForeignTasks = (taskIds: string[]): void => {
		if (foreignNotified || taskIds.length === 0) return;
		foreignNotified = true;
		notifyLoop(
			ctx,
			`Loop：${taskIds.length} 个任务的 run 属于其他会话（本会话可能是 fork）；对应任务已在本地取消、不再追踪，磁盘不受影响。`,
			"info",
		);
		options.onForeignTasks?.(taskIds);
	};
	const sessionId = ctx.sessionManager.getSessionId();
	const catalog: RunCatalog =
		options.catalog ??
		createRunCatalog({
			runsRoot: join(ctx.cwd, ".pi", "scheduled-wakeup", "v2", "runs"),
			ownerSessionId: sessionId,
			onForeignTasks,
		});
	const watcher: RunWatcher = options.watcher ?? createRunWatcher();
	const coordinator: DeliveryCoordinator = createDeliveryCoordinator(
		pi,
		ctx,
		catalog,
	);
	const meta = new Map<string, RunMeta>();
	let closed = false;
	let booted = false;

	const viewFrom = (run: WatchedRun): RunView => {
		const record = meta.get(run.dir);
		return {
			taskId: run.taskId,
			runId: run.runId,
			dir: run.dir,
			startedAt: run.startedAt,
			record: {
				version: 1,
				taskId: run.taskId,
				scope: record?.scope ?? "session",
				payload: record?.payload ?? { prompt: "" },
				ownerSessionId: sessionId,
				startedAt: run.startedAt,
			},
			status: parseStatus(run.status),
			outcome: parseOutcome(run.outcome),
			state: run.state,
		};
	};

	const activeRuns = (taskId?: string): WatchedRun[] =>
		watcher
			.snapshot()
			.filter(
				(run) =>
					(run.state === "running" || run.state === "pendingDelivery") &&
					(taskId === undefined || run.taskId === taskId),
			);

	const isWedged = (run: WatchedRun): boolean => {
		const budget = meta.get(run.dir)?.budgetMs;
		if (budget === undefined) return false;
		const lastUpdate = run.status?.updatedAt ?? run.startedAt;
		return Date.now() - lastUpdate > budget;
	};

	const handleEvents = (events: readonly import("./run-watch/run-watcher.js").RunEvent[]): boolean => {
		if (events.length === 0) return false;
		for (const event of events) {
			if (event.type === "state") {
				if (event.run.state === "lost") {
					catalog.repairLost(event.run.dir);
					continue;
				}
				if (event.run.state === "pendingDelivery") {
					coordinator.enqueueRun(viewFrom(event.run));
				}
			} else if (event.type === "error") {
				if (event.err.kind === "not-my") {
					onForeignTasks([event.err.taskId]);
					continue;
				}
				if (event.err.kind === "vanished") {
					notifyLoop(
						ctx,
						`Loop：run 目录异常消失（${event.err.taskId} / ${event.err.runId}）。`,
						"warning",
					);
					continue;
				}
				notifyLoop(
					ctx,
					`Loop：run 监控异常（${event.err.detail}）。`,
					"warning",
				);
			}
		}
		return true;
	};

	const tick = (): void => {
		if (closed) return;
		const hadEvents = handleEvents(watcher.poll());
		if (!hadEvents) return; // nothing new: update nothing, wait zero
		coordinator.pump();
		options.onChange();
	};

	const refresh = async (): Promise<void> => {
		await bootPromise;
		tick();
	};

	const boot = async (): Promise<void> => {
		const { criteriaMs } = await resolveCriteria();
		const bootResult = await catalog.bootScan(criteriaMs);
		if (closed) return;
		for (const view of bootResult.views) {
			if (view.state !== "running" && view.state !== "pendingDelivery")
				continue;
			meta.set(view.dir, {
				scope: view.record.scope,
				payload: view.record.payload,
				budgetMs: runBudgetMs(view),
			});
			watcher.watch({
				dir: view.dir,
				taskId: view.taskId,
				runId: view.runId,
				startedAt: view.startedAt,
				sessionId,
			});
		}
		booted = true;
		options.onSettled();
		tick();
	};

	const resolveCriteria =
		options.loadGcCriteria ??
		(async (): Promise<{ criteriaMs: number; label: string }> => ({
			criteriaMs: options.gcCriteriaMs ?? DEFAULT_GC_CRITERIA_MS,
			label: describeGcCriteria(options.gcCriteriaMs ?? DEFAULT_GC_CRITERIA_MS),
		}));
	const bootPromise: Promise<void> = boot().catch((error) => {
		notifyLoop(ctx, `Loop：启动扫描失败（${String(error)}）。`, "error");
	});
	const timer = setInterval(tick, options.intervalMs ?? TICK_MS);
	// E31: headless runner mode must keep the process alive until delivery.
	if (!isRunnerEnabled()) timer.unref?.();

	const stabilized = async (taskId: string): Promise<void> => {
		for (let i = 0; i < 300; i++) {
			// A completing run's pendingDelivery event must reach the
			// coordinator (under the stop barrier) before the final retraction.
			tick();
			if (activeRuns(taskId).length === 0) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};

	return {
		dispatch(target) {
			if (closed) throw new Error("Loop dispatcher is inactive");
			const blocking = activeRuns(target.id).find(
				(run) => run.state === "running",
			);
			if (blocking !== undefined) {
				// A wedged run (no progress past its timeout budget) would block
				// this task forever: kill it and let the next poller retry take
				// over instead of spinning on refusals.
				if (isWedged(blocking)) {
					notifyLoop(
						ctx,
						`Loop：${target.id} 的上一轮 run 已超时无进展，正在终止；下一轮（≤60s）自动重试。`,
						"info",
					);
					void catalog
						.cancelRunning(viewFrom(blocking))
						.then(() => {
							watcher.unwatch(blocking.dir);
							options.onChange();
						})
						.catch(() => undefined);
				}
				throw new LoopTaskActiveError(target.id);
			}
			if (
				target.scriptTask !== undefined &&
				target.scriptTask.scripts.length > 0
			) {
				if (!booted)
					throw new Error(
						"Loop dispatcher is still performing its initial scan",
					);
				const view = catalog.startRun(target);
				meta.set(view.dir, {
					scope: target.scope,
					payload: view.record.payload,
					budgetMs: runBudgetMs(view),
				});
				watcher.watch({
					dir: view.dir,
					taskId: view.taskId,
					runId: view.runId,
					startedAt: view.startedAt,
					sessionId,
				});
			} else if (target.scriptTask !== undefined) {
				coordinator.enqueuePrompt({
					id: target.id,
					scope: target.scope,
					prompt:
						target.scriptTask.wakeUp.kind === "never"
							? ""
							: target.scriptTask.wakeUp.prompt,
					...(target.includeTimestamp === true
						? { includeTimestamp: true }
						: {}),
				});
			} else {
				coordinator.enqueuePrompt(target);
			}
			options.onSettled();
		},
		isStarting(taskId: string): boolean {
			return activeRuns(taskId).some((run) => run.state === "running");
		},
		list() {
			return activeRuns()
				.filter((run) => run.state === "running")
				.map((run) => {
					const record = meta.get(run.dir);
					const scripts = record?.payload.scriptTask?.scripts ?? [];
					return {
						id: run.taskId,
						wakeUpId: run.taskId,
						startedAt: run.startedAt,
						budgetMs: record?.budgetMs,
						success: run.status?.success ?? 0,
						completed: run.status?.completed ?? 0,
						total: run.status?.total ?? scripts.length,
						current: scripts[run.status?.currentIndex ?? 0],
					};
				});
		},
		liveRuns() {
			return activeRuns().map(viewFrom);
		},
		deliveryStatus() {
			return coordinator.deliveryStatus();
		},
		retractPending(taskId) {
			return coordinator.cancelPending(taskId);
		},
		requestRunTermination(taskId) {
			const runs = activeRuns(taskId);
			const retracted = coordinator.cancelPending(taskId);
			let signalled = 0;
			for (const run of runs) {
				if (run.state !== "running") continue;
				const pid = run.status?.pid;
				if (pid === undefined) continue;
				try {
					process.kill(pid, "SIGTERM");
					signalled += 1;
				} catch {
					/* Already dead; the watch worker records the terminal state. */
				}
			}
			return { signalled, retracted };
		},
		async cancelRun(view) {
			if (view.state === "pendingDelivery") {
				coordinator.cancelPending(view.taskId);
				await refresh();
				return "cancelled";
			}
			const result = await catalog.cancelRunning(view);
			watcher.unwatch(view.dir);
			meta.delete(view.dir);
			options.onChange();
			return result;
		},
		async terminateTaskRuns(taskId) {
			// R5: block delivery for this task before the first await so a
			// completing run cannot be pumped out mid-stop.
			coordinator.setDeliveryBarrier(taskId, true);
			try {
				let killed = 0;
				let retracted = coordinator.cancelPending(taskId);
				for (const run of activeRuns(taskId)) {
					if (run.state !== "running") continue;
					await catalog.cancelRunning(viewFrom(run));
					watcher.unwatch(run.dir);
					meta.delete(run.dir);
					killed += 1;
				}
				await stabilized(taskId);
				retracted += coordinator.cancelPending(taskId);
				// The mirror changed without a worker event; refresh the widget
				// now instead of waiting for the next event.
				options.onChange();
				return { killed, retracted };
			} finally {
				coordinator.setDeliveryBarrier(taskId, false);
			}
		},
		async garbageCollect() {
			const { criteriaMs, label } = await resolveCriteria();
			const deleted = await catalog.gc(criteriaMs);
			return { deleted, label };
		},
		runsOverview() {
			return activeRuns().map((run) => {
				if (run.state === "running")
					return `${run.taskId} | running (${run.status?.completed ?? 0}/${run.status?.total ?? 0} scripts, pid ${run.status?.pid ?? "?"})`;
				return `${run.taskId} | pending delivery (${run.outcome?.shouldWake === true ? "wake" : "no wake"})`;
			});
		},
		refresh,
		dispose() {
			if (closed) return;
			closed = true;
			clearInterval(timer);
			watcher.dispose();
			coordinator.dispose();
		},
	};
}

/** Shared with the widget so the displayed max always equals the enforced one. */
export function runBudgetMs(view: RunView): number | undefined {
	const scripts = view.record.payload.scriptTask?.scripts ?? [];
	// null means unlimited: a legal long run must never be force-cancelled.
	if (scripts.some((script) => script.timeoutSeconds === null)) return undefined;
	const timeoutSeconds = Math.max(
		0,
		...scripts.map((script) => script.timeoutSeconds ?? 1800),
		1800,
	);
	return timeoutSeconds * 1000 + 120_000;
}
