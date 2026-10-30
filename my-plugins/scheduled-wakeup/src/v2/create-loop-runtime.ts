import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createLoopCore } from "../create-loop-core.js";
import type { LoopV2Runtime } from "../loop-command-handler.js";
import { loopErrorMessage } from "../loop-error-message.js";
import { notifyLoop } from "../loop-notification.js";
import { createRunningWidget } from "../loop-running-widget.js";
import { collectLoopWidgetItems } from "../loop-widget-items.js";
import { readLoopWidgetVisibility } from "../loop-widget-visibility.js";
import { isRunnerEnabled, pollerEnabled } from "../runner-mode.js";
import { createTaskDispatcher } from "../task-dispatcher.js";
import { AiSessionActions } from "./ai-session-actions.js";
import {
	createBoulderSync,
	inhibitingIdsFromSnapshot,
	type BoulderSyncBridge,
} from "./boulder-sync.js";
import { DuePoller } from "./due-poller.js";
import { formatActiveTasks } from "./format-list.js";
import { UserLoopV2Commands } from "./user-commands.js";

export function createLoopRuntime(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): LoopV2Runtime {
	const core = createLoopCore(pi, ctx);
	core.reconcileSharedRegistrations();
	core.resumeSchedules();
	// Boulder sync fires on every mutation/afterRun/settle; on huge sessions a
	// full state snapshot per sync is too costly — cache the inhibiting set briefly.
	let inhibitingCache: { at: number; ids: Set<string> } | undefined;
	const inhibitingIds = (): Set<string> => {
		if (inhibitingCache === undefined || Date.now() - inhibitingCache.at > 5000) {
			inhibitingCache = {
				at: Date.now(),
				ids: inhibitingIdsFromSnapshot(
					core.snapshotSessionState(),
					(id) => core.registrationInhibition(id),
				),
			};
		}
		return inhibitingCache.ids;
	};
	// R7: business sync must not ride on widget visibility; it runs on every
	// dispatcher state change (each scan) and on explicit invalidation.
	let inhibitCacheDirty = true;
	const runtimeRef: { boulderSync: BoulderSyncBridge | undefined } = { boulderSync: undefined };
	const syncBoulder = (): void => {
		if (inhibitCacheDirty) {
			inhibitingCache = undefined;
			inhibitCacheDirty = false;
		}
		runtimeRef.boulderSync?.sync();
	};
	const dispatcher = createTaskDispatcher(pi, ctx, {
		onForeignTasks: (taskIds) => {
			// A real fork inherited the task entries: cancel them locally so this
			// session stops scheduling/tracking work whose runs belong elsewhere.
			for (const taskId of taskIds) core.cancelActive(taskId);
		},
		onChange: () => {
			syncBoulder();
			widget.refresh();
		},
		onSettled: () => {
			const result = runtime.poller?.reschedule();
			if (result?.ok === false) notifyLoop(ctx, result.message, "error");
		},
	});
	const widget = createRunningWidget(
		ctx,
		() => collectLoopWidgetItems(core.listActive(), dispatcher.list(), dispatcher.deliveryStatus()),
		readLoopWidgetVisibility(ctx.sessionManager.getBranch()),
	);
	const runtime: LoopV2Runtime = {
		core,
		dispatcher,
		invalidateInhibitionCache: () => {
			inhibitCacheDirty = true;
			syncBoulder();
		},
		widget,
		user: new UserLoopV2Commands(core),
		actions: new AiSessionActions(core, {
			formatOverview: (active) =>
				formatActiveTasks(
					active,
					dispatcher.list(),
					dispatcher.deliveryStatus(),
					Date.now(),
				),
			liveRunIds: () => dispatcher.liveRuns().map((view) => view.taskId),
			terminateTaskRuns: (taskId) => dispatcher.terminateTaskRuns(taskId),
		}),
		poller: undefined,
		boulderSync: createBoulderSync(pi, ctx, core, {
			liveInhibitingRun: () => {
				const inhibiting = inhibitingIds();
				if (inhibiting.size === 0) return false;
				// `starting` closes the zero-latency window between dispatch and
				// the first scan tick observing the new run; without it a once
				// task (completed at dispatch) drops the signal mid-run.
				const live = new Set(dispatcher.liveRuns().map((view) => view.taskId));
				for (const id of inhibiting)
					if (live.has(id) || dispatcher.isStarting(id)) return true;
				return false;
			},
		}),
		cwd: ctx.cwd,
		sessionManager: ctx.sessionManager,
		sessionId: ctx.sessionManager.getSessionId(),
		dispose() {
			try {
				runtime.poller?.dispose();
			} finally {
				try {
					dispatcher.dispose();
				} finally {
					widget.dispose();
				}
			}
		},
	};
	runtimeRef.boulderSync = runtime.boulderSync;
	if (pollerEnabled(ctx)) {
		const poller = new DuePoller({
			core,
			deliver: dispatcher.dispatch,
			keepAlive: isRunnerEnabled(),
			afterRun: () => {
				widget.refresh();
				runtime.boulderSync?.sync();
			},
			onError: (error) =>
				notifyLoop(
					ctx,
					`Loop polling stopped: ${loopErrorMessage(error)}`,
					"warning",
				),
		});
		runtime.poller = poller;
		try {
			poller.start();
		} catch (error) {
			runtime.dispose();
			throw error;
		}
	}
	runtime.boulderSync?.sync();
	widget.refresh();
	return runtime;
}
