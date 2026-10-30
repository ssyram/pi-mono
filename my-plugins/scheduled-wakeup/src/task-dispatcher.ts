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
	const starting = new Set<string>();
	const refresh = async (): Promise<void> => {
		if (closed) return;
		if (refreshing) {
			refreshQueued = true;
			return;
		}
		refreshing = true;
		try {
			do {
				refreshQueued = false;
				views = await catalog.scan();
				if (closed) break;
				for (const view of views) coordinator.enqueueRun(view);
				options.onChange();
			} while (refreshQueued && !closed);
		} finally {
			refreshing = false;
		}
	};
	const timer = setInterval(() => {
		void refresh().catch(() => undefined);
	}, options.intervalMs ?? SCAN_INTERVAL_MS);
	// E31: headless runner mode must keep the process alive until delivery.
	if (!isRunnerEnabled()) timer.unref?.();
	void refresh().catch(() => undefined);
	return {
		dispatch(target) {
			if (closed) throw new Error("Loop dispatcher is inactive");
			if (
				starting.has(target.id) ||
				views.some(
					(view) => view.taskId === target.id && view.state === "running",
				)
			)
				throw new Error(`Loop task ${target.id} is already running`);
			if (
				target.scriptTask !== undefined &&
				target.scriptTask.scripts.length > 0
			) {
				starting.add(target.id);
				catalog.startRun(target);
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
			return views.filter(
				(view) =>
					view.state === "running" || view.state === "pendingDelivery",
			);
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
			const runs = views.filter(
				(view) =>
					view.taskId === taskId &&
					(view.state === "running" || view.state === "pendingDelivery"),
			);
			let killed = 0;
			let retracted = coordinator.cancelPending(taskId);
			for (const view of runs) {
				if (view.state !== "running") continue;
				await catalog.cancelRunning(view);
				killed += 1;
			}
			await refresh();
			retracted += coordinator.cancelPending(taskId);
			return { killed, retracted };
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
}
