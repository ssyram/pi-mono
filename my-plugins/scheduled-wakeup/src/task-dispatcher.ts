import { join } from "node:path";
import { notifyLoop } from "./loop-notification.js";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ScriptSpec } from "./script-tasks/task-spec.js";
import { isRunnerEnabled } from "./runner-mode.js";
import {
	createDeliveryCoordinator,
	type DeliveryCoordinator,
} from "./v2/delivery-coordinator.js";
import { createRunCatalog, type RunCatalog } from "./v2/run-catalog.js";
import type { RunView } from "./v2/run-catalog-state.js";
import type { ExecutionTarget } from "./v2/model.js";

export type RunningTask = {
	id: string;
	wakeUpId: string;
	success: number;
	completed: number;
	total: number;
	current?: ScriptSpec | undefined;
};

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
	refresh(): Promise<void>;
	dispose(): void;
};

export type RunTermination = { killed: number; retracted: number };

const SCAN_INTERVAL_MS = 1000;

export function createTaskDispatcher(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: {
		onChange(): void;
		onSettled(): void;
		catalog?: RunCatalog;
		intervalMs?: number;
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
	const catalog: RunCatalog =
		options.catalog ??
		createRunCatalog({
			runsRoot: join(ctx.cwd, ".pi", "scheduled-wakeup", "v2", "runs"),
			ownerSessionId: ctx.sessionManager.getSessionId(),
			onForeignTasks,
		});
	const coordinator: DeliveryCoordinator = createDeliveryCoordinator(
		pi,
		ctx,
		catalog,
	);
	let views: RunView[] = [];
	let refreshing = false;
	let refreshQueued = false;
	let closed = false;
	let booted = false;
	let epoch = 0;
	// R1: a scan may only release placeholders spawned before that scan began.
	const starting = new Map<string, number>();
	// R4: runs spawned locally but not yet observed by any completed scan.
	const spawned = new Map<string, { view: RunView; epoch: number }>();
	let drainWaiters: Array<() => void> = [];
	const refresh = async (): Promise<void> => {
		if (closed) return;
		if (refreshing) {
			refreshQueued = true;
			// Await refresh() must observe a scan generation that started
			// after this call, not return while one is still draining.
			await new Promise<void>((resolve) => drainWaiters.push(resolve));
			return;
		}
		refreshing = true;
		try {
			do {
				refreshQueued = false;
				// R3: a tick may skip instead of queueing an endless drain.
				const scanEpoch = ++epoch;
				views = await catalog.scan();
				if (closed) break;
				for (const view of views) coordinator.enqueueRun(view);
				for (const [id, spawnEpoch] of starting)
					if (
						scanEpoch >= spawnEpoch &&
						!views.some(
							(view) => view.taskId === id && view.state === "running",
						)
					)
						starting.delete(id);
				for (const [id, record] of spawned)
					if (
						scanEpoch >= record.epoch ||
						views.some(
							(view) =>
								view.taskId === id && view.state === "running",
						)
					)
						spawned.delete(id);
				if (!booted) {
					booted = true;
					options.onSettled();
				}
				options.onChange();
			} while (refreshQueued && !closed);
		} finally {
			refreshing = false;
			const waiters = drainWaiters;
			drainWaiters = [];
			for (const resolve of waiters) resolve();
		}
	};
	const stabilized = async (): Promise<void> => {
		for (let i = 0; i < 500; i++) {
			if (!refreshing && !refreshQueued) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};
	const timer = setInterval(() => {
		// R3: never queue from the tick; only mutations may request a drain.
		if (!refreshing) void refresh().catch(() => undefined);
	}, options.intervalMs ?? SCAN_INTERVAL_MS);
	// E31: headless runner mode must keep the process alive until delivery.
	if (!isRunnerEnabled()) timer.unref?.();
	void refresh().catch(() => undefined);
	const runtimeExports: TaskDispatcher = {
		dispatch(target) {
			if (closed) throw new Error("Loop dispatcher is inactive");
			const blocking =
				spawned.get(target.id)?.view ??
				views.find(
					(view) => view.taskId === target.id && view.state === "running",
				);
			if (starting.has(target.id) || blocking !== undefined) {
				// A wedged run (no progress past its timeout budget) would block
				// this task forever: kill it and let the next poller retry take
				// over instead of spinning on refusals ("Waiting 0s" deadlock).
				if (blocking !== undefined && isWedged(blocking)) {
					notifyLoop(
						ctx,
						`Loop：${target.id} 的上一轮 run 已超时无进展，正在终止；下一轮（≤60s）自动重试。`,
						"info",
					);
					void catalog
						.cancelRunning(blocking)
						.then(() => refresh())
						.catch(() => undefined);
				}
				throw new Error(`Loop task ${target.id} is already running`);
			}
			if (
				target.scriptTask !== undefined &&
				target.scriptTask.scripts.length > 0
			) {
				if (!booted)
					throw new Error(
						"Loop dispatcher is still performing its initial scan",
					);
				starting.set(target.id, epoch + 1);
				spawned.set(target.id, {
					view: catalog.startRun(target),
					epoch: epoch + 1,
				});
				void refresh().catch(() => undefined);
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
			return starting.has(taskId) || spawned.has(taskId);
		},
		list() {
			return views
				.filter((view) => view.state === "running")
				.map((view) => {
					const scripts = view.record.payload.scriptTask?.scripts ?? [];
					const status = view.status;
					return {
						id: view.taskId,
						wakeUpId: view.taskId,
						success: status?.success ?? 0,
						completed: status?.completed ?? 0,
						total: status?.total ?? scripts.length,
						current: scripts[status?.currentIndex ?? 0],
					};
				});
		},
		liveRuns() {
			const merged = new Map<string, RunView>();
			for (const view of views)
				if (
					view.state === "running" ||
					view.state === "pendingDelivery"
				)
					merged.set(view.taskId, view);
			for (const record of spawned.values())
				merged.set(record.view.taskId, record.view);
			return [...merged.values()];
		},
		deliveryStatus() {
			return coordinator.deliveryStatus();
		},
		retractPending(taskId) {
			return coordinator.cancelPending(taskId);
		},
		requestRunTermination(taskId) {
			const runs = views.filter(
				(view) =>
					view.taskId === taskId &&
					(view.state === "running" || view.state === "pendingDelivery"),
			);
			const retracted = coordinator.cancelPending(taskId);
			let signalled = 0;
			for (const view of runs) {
				if (view.state !== "running") continue;
				const pid = view.status?.pid;
				if (pid === undefined) continue;
				try {
					process.kill(pid, "SIGTERM");
					signalled += 1;
				} catch {
					/* Already dead; the scan tick records the terminal state. */
				}
			}
			void refresh().catch(() => undefined);
			return { signalled, retracted };
		},
		async cancelRun(view) {
			if (view.state === "pendingDelivery") {
				coordinator.cancelPending(view.taskId);
				await refresh();
				return "cancelled";
			}
			const result = await catalog.cancelRunning(view);
			await refresh();
			return result;
		},
		async terminateTaskRuns(taskId) {
			// R5: block delivery for this task before the first await so a
			// completing run cannot be pumped out mid-stop.
			coordinator.setDeliveryBarrier(taskId, true);
			try {
				const runs = [...views, ...[...spawned.values()].map((r) => r.view)]
					.filter(
						(view) =>
							view.taskId === taskId &&
							(view.state === "running" ||
								view.state === "pendingDelivery"),
					);
				let killed = 0;
				let retracted = coordinator.cancelPending(taskId);
				for (const view of runs) {
					if (view.state !== "running") continue;
					await catalog.cancelRunning(view);
					killed += 1;
				}
				await refresh();
				await stabilized();
				retracted += coordinator.cancelPending(taskId);
				return { killed, retracted };
			} finally {
				coordinator.setDeliveryBarrier(taskId, false);
			}
		},
		runsOverview() {
			return views
				.filter(
					(view) =>
						view.state === "running" || view.state === "pendingDelivery",
				)
				.map((view) => {
					const status = view.status;
					if (view.state === "running")
						return `${view.taskId} | running (${status?.completed ?? 0}/${status?.total ?? 0} scripts, pid ${status?.pid ?? "?"})`;
					return `${view.taskId} | pending delivery (${view.outcome?.shouldWake === true ? "wake" : "no wake"})`;
				});
		},
		refresh,
		dispose() {
			if (closed) return;
			closed = true;
			clearInterval(timer);
			coordinator.dispose();
		},
	};
	return runtimeExports;
}

function isWedged(view: RunView): boolean {
	const scripts = view.record.payload.scriptTask?.scripts ?? [];
	// null means unlimited: a legal long run must never be force-cancelled.
	if (scripts.some((script) => script.timeoutSeconds === null)) return false;
	const timeoutSeconds = Math.max(
		0,
		...scripts.map((script) => script.timeoutSeconds ?? 1800),
		1800,
	);
	const lastUpdate = view.status?.updatedAt ?? view.startedAt;
	return Date.now() - lastUpdate > timeoutSeconds * 1000 + 120_000;
}
