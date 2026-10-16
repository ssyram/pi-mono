import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { BOULDER_INHIBITION_READY_CHANNEL } from "../../oh-my-pi-v2/boulder-inhibition/service-protocol.js";
import {
	handleLoopCommand,
	type LoopV2Runtime,
} from "./loop-command-handler.js";
import { loopErrorMessage } from "./loop-error-message.js";
import { notifyLoop } from "./loop-notification.js";
import { createLoopRuntime } from "./v2/create-loop-runtime.js";
import { createLoopCommandAutocompleteProvider } from "./v2/loop-command-autocomplete.js";
import { parseLoopV2Command } from "./v2/parse-v2-command.js";
import { registerScheduledWakeupV2Tool } from "./v2/register-v2-tool.js";

type Instance = { dispose(): void };

declare global {
	var __scheduledWakeupInstance: Instance | undefined;
}

export default function scheduledWakeup(pi: ExtensionAPI): void {
	let cleanup: (() => void) | undefined;
	try {
		globalThis.__scheduledWakeupInstance?.dispose();

		let runtime: LoopV2Runtime | undefined;
		let unsubscribeReady: (() => void) | undefined;
		let disposed = false;
		const dispose = (): void => {
			disposed = true;
			unsubscribeReady?.();
			unsubscribeReady = undefined;
			runtime?.poller?.dispose();
			runtime = undefined;
			if (globalThis.__scheduledWakeupInstance?.dispose === dispose) {
				globalThis.__scheduledWakeupInstance = undefined;
			}
		};
		cleanup = dispose;
		const isActive = (): boolean =>
			!disposed && globalThis.__scheduledWakeupInstance?.dispose === dispose;
		globalThis.__scheduledWakeupInstance = { dispose };

		const ensure = (ctx: ExtensionContext): LoopV2Runtime => {
			if (
				runtime?.cwd === ctx.cwd &&
				runtime.sessionManager === ctx.sessionManager &&
				runtime.sessionId === ctx.sessionManager.getSessionId()
			)
				return runtime;
			runtime?.poller?.dispose();
			runtime = undefined;
			runtime = createLoopRuntime(pi, ctx);
			return runtime;
		};
		unsubscribeReady = pi.events.on(
			BOULDER_INHIBITION_READY_CHANNEL,
			(data) => {
				if (!isActive()) return;
				try {
					if (
						runtime !== undefined &&
						typeof data === "object" &&
						data !== null &&
						"session" in data &&
						data.session === runtime.sessionManager
					)
						runtime.boulderSync?.sync();
				} catch (error) {
					try {
						console.error(
							`Loop service sync failed: ${loopErrorMessage(error)}`,
						);
					} catch {
						/* No UI context here. */
					}
				}
			},
		);
		const reschedule = (): string | undefined => {
			const result = runtime?.poller?.reschedule();
			return result?.ok === false ? result.message : undefined;
		};

		const registerAutocomplete = (ctx: ExtensionContext): void => {
			const registrar = ctx.ui as ExtensionUIContext & {
				addAutocompleteProvider?(
					factory: (current: AutocompleteProvider) => AutocompleteProvider,
				): void;
			};
			registrar.addAutocompleteProvider?.((current) =>
				createLoopCommandAutocompleteProvider(current, {
					activeIds: () => runtime?.core.activeIds() ?? [],
					sharedDefinitionIds: (scopes) =>
						runtime?.core.sharedDefinitionIds(scopes) ?? [],
				}),
			);
		};

		pi.on("session_start", async (_event, ctx) => {
			if (!isActive()) return;
			try {
				ensure(ctx);
				registerAutocomplete(ctx);
				const refreshError = reschedule();
				if (refreshError !== undefined) {
					notifyLoop(ctx, refreshError, "error");
					return;
				}
				notifyLoop(ctx, "Scheduled wakeup loaded", "info");
			} catch (error) {
				notifyLoop(
					ctx,
					`Loop startup failed: ${loopErrorMessage(error)}. State may already have changed.`,
					"error",
				);
			}
		});

		pi.on("session_tree", async (_event, ctx) => {
			if (!isActive()) return;
			try {
				ensure(ctx).boulderSync?.sync();
				const refreshError = reschedule();
				if (refreshError !== undefined) notifyLoop(ctx, refreshError, "error");
			} catch (error) {
				notifyLoop(
					ctx,
					`Loop branch refresh failed: ${loopErrorMessage(error)}`,
					"error",
				);
			}
		});

		pi.on("session_shutdown", async (_event, ctx) => {
			if (!isActive()) return;
			try {
				runtime?.poller?.dispose();
				runtime?.core.suspendSchedules();
			} catch (error) {
				notifyLoop(
					ctx,
					`Loop shutdown failed: ${loopErrorMessage(error)}. State may already have changed.`,
					"error",
				);
			} finally {
				try {
					dispose();
				} catch (error) {
					notifyLoop(
						ctx,
						`Loop cleanup failed: ${loopErrorMessage(error)}`,
						"error",
					);
				}
			}
		});

		pi.registerCommand("loop", {
			description: "Schedule one-shot, recurring, or shared registered prompts",
			handler: async (args, ctx) => {
				if (!isActive()) return;
				try {
					handleLoopCommand(
						pi,
						parseLoopV2Command(args),
						ensure(ctx),
						ctx,
						reschedule,
					);
					runtime?.boulderSync?.sync();
				} catch (error) {
					notifyLoop(
						ctx,
						`Loop command failed: ${loopErrorMessage(error)}. State may already have changed.`,
						"error",
					);
				}
			},
		});

		registerScheduledWakeupV2Tool(pi, {
			getActions: (ctx) => {
				if (!isActive()) throw new Error("Loop instance is inactive");
				return ensure(ctx).actions;
			},
			onMutation: () => {
				runtime?.boulderSync?.sync();
				return reschedule();
			},
		});
	} catch (error) {
		try {
			cleanup?.();
		} catch {
			/* Keep setup failure primary. */
		}
		try {
			console.error(`Loop setup failed: ${loopErrorMessage(error)}`);
		} catch {
			/* No bound UI is available during setup. */
		}
	}
}
