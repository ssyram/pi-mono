import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLoopCore } from "../create-loop-core.js";
import type { LoopV2Runtime } from "../loop-command-handler.js";
import { loopErrorMessage } from "../loop-error-message.js";
import { notifyLoop } from "../loop-notification.js";
import { isRunnerEnabled, pollerEnabled } from "../runner-mode.js";
import { AiSessionActions } from "./ai-session-actions.js";
import { createBoulderSync } from "./boulder-sync.js";
import { DuePoller } from "./due-poller.js";
import { UserLoopV2Commands } from "./user-commands.js";

export function createLoopRuntime(pi: ExtensionAPI, ctx: ExtensionContext): LoopV2Runtime {
	const core = createLoopCore(pi, ctx);
	core.reconcileSharedRegistrations();
	core.resumeSchedules();
	const runtime: LoopV2Runtime = {
		core,
		user: new UserLoopV2Commands(core),
		actions: new AiSessionActions(core),
		poller: undefined,
		boulderSync: createBoulderSync(pi, ctx, core),
		cwd: ctx.cwd,
		sessionManager: ctx.sessionManager,
		sessionId: ctx.sessionManager.getSessionId(),
	};
	if (pollerEnabled(ctx)) {
		const poller = new DuePoller({
			core,
			deliver: (target) => {
				if (ctx.isIdle()) pi.sendUserMessage(target.prompt);
				else pi.sendUserMessage(target.prompt, { deliverAs: "followUp" });
			},
			keepAlive: isRunnerEnabled(),
			afterRun: () => runtime.boulderSync?.sync(),
			onError: (error) => notifyLoop(ctx, `Loop polling stopped: ${loopErrorMessage(error)}`, "warning"),
		});
		runtime.poller = poller;
		try {
			poller.start();
		} catch (error) {
			poller.dispose();
			throw error;
		}
	}
	runtime.boulderSync?.sync();
	return runtime;
}
