import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BOULDER_INHIBITION_READY_CHANNEL } from "../../oh-my-pi-v2/boulder-inhibition/service-protocol.js";
import {
	handleLoopCommand,
	type LoopV2Runtime,
} from "./loop-command-handler.js";
import { loopErrorMessage } from "./loop-error-message.js";
import { claimLoopInstance } from "./loop-instance-owner.js";
import { notifyLoop } from "./loop-notification.js";
import { readLoopWidgetVisibility } from "./loop-widget-visibility.js";
import { sessionPersistenceError } from "./session-persistence-error.js";
import { registerTaskRunRenderer } from "./task-run-renderer.js";
import { createLoopRuntime } from "./v2/create-loop-runtime.js";
import { registerLoopAutocomplete } from "./v2/loop-command-autocomplete.js";
import { parseLoopV2Command } from "./v2/parse-v2-command.js";
import { registerScheduledWakeupV2Tool } from "./v2/register-v2-tool.js";

export default function scheduledWakeup(pi: ExtensionAPI): void {
	let cleanup: (() => void) | undefined;
	try {
		let runtime: LoopV2Runtime | undefined;
		let owner: object | undefined;
		let releaseOwner: (() => void) | undefined;
		let unsubscribeReady: (() => void) | undefined;
		let disposed = false;
		const dispose = (): void => {
			disposed = true;
			unsubscribeReady?.();
			unsubscribeReady = undefined;
			runtime?.dispose();
			runtime = undefined;
			releaseOwner?.();
			releaseOwner = undefined;
		};
		cleanup = dispose;
		const isActive = (): boolean => !disposed;

		const ensure = (ctx: ExtensionContext): LoopV2Runtime => {
			if (owner !== ctx.sessionManager) {
				releaseOwner?.();
				releaseOwner = claimLoopInstance(ctx.sessionManager, dispose);
				owner = ctx.sessionManager;
			}
			if (
				runtime?.cwd === ctx.cwd &&
				runtime.sessionManager === ctx.sessionManager &&
				runtime.sessionId === ctx.sessionManager.getSessionId()
			)
				return runtime;
			runtime?.dispose();
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
			runtime?.widget.refresh();
			const result = runtime?.poller?.reschedule();
			return result?.ok === false ? result.message : undefined;
		};

		registerTaskRunRenderer(pi);

		pi.on("session_start", async (_event, ctx) => {
			if (!isActive()) return;
			try {
				ensure(ctx);
				registerLoopAutocomplete(ctx, {
					taskLabels: () =>
						runtime?.core.listActive().map((item) =>
							item.kind === "session"
								? {
										id: item.task.definition.id,
										name: item.task.definition.name,
									}
									: {
										id: item.registration.id,
										name: item.definition?.name,
									},
						) ?? [],
					definitionLabels: (scopes) =>
						runtime?.core
							.listDefinitions(scopes)
							.map((definition) => ({
								id: definition.id,
								name: definition.name,
							})) ?? [],
				});
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
				const current = ensure(ctx);
				current.widget.setVisible(
					readLoopWidgetVisibility(ctx.sessionManager.getBranch()),
				);
				current.boulderSync?.sync();
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
				runtime?.dispose();
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
					const command = parseLoopV2Command(args, Date.now(), ctx.cwd);
					if (
						command.kind === "add" ||
						command.kind === "define" ||
						command.kind === "register"
					) {
						const error = sessionPersistenceError(ctx);
						if (error !== undefined) {
							notifyLoop(ctx, error, "error");
							return;
						}
					}
					handleLoopCommand(pi, command, ensure(ctx), ctx, reschedule);
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
			validateAdd: sessionPersistenceError,
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
