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
import { createBoulderSync } from "./boulder-sync.js";
import { DuePoller } from "./due-poller.js";
import { UserLoopV2Commands } from "./user-commands.js";

export function createLoopRuntime(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): LoopV2Runtime {
	const core = createLoopCore(pi, ctx);
	core.reconcileSharedRegistrations();
	core.resumeSchedules();
	const dispatcher = createTaskDispatcher(pi, ctx, {
		onChange: () => widget.refresh(),
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
		widget,
		user: new UserLoopV2Commands(core),
		actions: new AiSessionActions(core),
		poller: undefined,
		boulderSync: createBoulderSync(pi, ctx, core),
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
