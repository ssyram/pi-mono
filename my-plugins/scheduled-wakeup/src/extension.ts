import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { AiSessionActions } from "./v2/ai-session-actions.js";
import { DuePoller } from "./v2/due-poller.js";
import { createLoopCommandAutocompleteProvider } from "./v2/loop-command-autocomplete.js";
import { LoopV2Core } from "./v2/loop-core.js";
import { handleLoopCommand, type LoopV2Runtime } from "./loop-command-handler.js";
import { parseLoopV2Command } from "./v2/parse-v2-command.js";
import type { SessionEntryPort } from "./v2/session-entry-adapter.js";
import { registerScheduledWakeupV2Tool } from "./v2/register-v2-tool.js";
import { UserLoopV2Commands } from "./v2/user-commands.js";

const RUNNER_ENV = "PI_SCHEDULED_WAKEUP_RUNNER";

type Instance = { dispose(): void };

declare global {
	var __scheduledWakeupInstance: Instance | undefined;
}

export default function scheduledWakeup(pi: ExtensionAPI): void {
	globalThis.__scheduledWakeupInstance?.dispose();

	let runtime: LoopV2Runtime | undefined;
	let disposed = false;
	const dispose = (): void => {
		disposed = true;
		runtime?.poller?.dispose();
		runtime = undefined;
		if (globalThis.__scheduledWakeupInstance?.dispose === dispose) {
			globalThis.__scheduledWakeupInstance = undefined;
		}
	};
	const isActive = (): boolean => !disposed && globalThis.__scheduledWakeupInstance?.dispose === dispose;
	globalThis.__scheduledWakeupInstance = { dispose };

	const ensure = (ctx: ExtensionContext): LoopV2Runtime => {
		if (runtime !== undefined && runtime.cwd === ctx.cwd) return runtime;
		runtime?.poller?.dispose();
		const core = createCore(pi, ctx);
		const created: LoopV2Runtime = { core, user: new UserLoopV2Commands(core), actions: new AiSessionActions(core), poller: undefined, cwd: ctx.cwd };
		runtime = created;
		if (pollerEnabled(ctx)) {
			created.poller = new DuePoller({ core, deliver: deliverPrompt(pi, ctx), keepAlive: isRunnerEnabled() });
			created.poller.start();
		}
		return created;
	};
	const reschedule = (): void => runtime?.poller?.reschedule();

	const registerAutocomplete = (ctx: ExtensionContext): void => {
		const registrar = ctx.ui as ExtensionUIContext & {
			addAutocompleteProvider?(factory: (current: AutocompleteProvider) => AutocompleteProvider): void;
		};
		registrar.addAutocompleteProvider?.((current) =>
			createLoopCommandAutocompleteProvider(current, {
				activeIds: () => runtime?.core.activeIds() ?? [],
				sharedDefinitionIds: (scopes) => runtime?.core.sharedDefinitionIds(scopes) ?? [],
			}),
		);
	};

	pi.on("session_start", async (_event, ctx) => {
		if (!isActive()) return;
		const created = ensure(ctx);
		created.core.reconcileSharedRegistrations();
		registerAutocomplete(ctx);
		reschedule();
		if (ctx.hasUI) ctx.ui.notify("Scheduled wakeup loaded", "info");
	});

	pi.on("session_shutdown", async () => dispose());

	pi.registerCommand("loop", {
		description: "Schedule one-shot, recurring, or shared registered prompts",
		handler: async (args, ctx) => {
			if (!isActive()) return;
			handleLoopCommand(pi, parseLoopV2Command(args), ensure(ctx), ctx, reschedule);
		},
	});

	registerScheduledWakeupV2Tool(pi, { getActions: (ctx) => ensure(ctx).actions, onMutation: reschedule });
}

function createCore(pi: ExtensionAPI, ctx: ExtensionContext): LoopV2Core {
	const sessionEntries: SessionEntryPort = {
		getBranch: () => ctx.sessionManager.getBranch(),
		appendEntry: (customType, data) => pi.appendEntry(customType, data),
	};
	return new LoopV2Core({
		sessionId: ctx.sessionManager.getSessionId(),
		sessionEntries,
		workspaceRoot: ctx.cwd,
		globalRoot: homedir(),
	});
}

function deliverPrompt(pi: ExtensionAPI, ctx: ExtensionContext): (target: { prompt: string }) => void {
	return (target) => {
		if (ctx.isIdle()) pi.sendUserMessage(target.prompt);
		else pi.sendUserMessage(target.prompt, { deliverAs: "followUp" });
	};
}

function pollerEnabled(ctx: ExtensionContext): boolean {
	const mode = contextMode(ctx);
	return (mode !== "print" && mode !== "json") || isRunnerEnabled();
}

/** Prefers the runtime-provided ctx.mode; falls back to argv sniffing when the loaded Pi build predates it. */
function contextMode(ctx: ExtensionContext): "tui" | "rpc" | "json" | "print" {
	const mode = (ctx as ExtensionContext & { mode?: "tui" | "rpc" | "json" | "print" }).mode;
	if (mode !== undefined) return mode;
	return isShortProcessInvocation() ? "print" : "tui";
}

function isShortProcessInvocation(): boolean {
	const args = process.argv.slice(2);
	return args.some((arg, index) => arg === "-p" || arg === "--print" || arg === "--mode=json" || (arg === "--mode" && args[index + 1] === "json"));
}

function isRunnerEnabled(): boolean {
	return process.env[RUNNER_ENV] === "1";
}
