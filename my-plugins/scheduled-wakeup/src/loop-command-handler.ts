import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { notifyLoop as notify } from "./loop-notification.js";
import { runPromptNow } from "./run-prompt-now.js";
import type { AiSessionActions } from "./v2/ai-session-actions.js";
import type { BoulderSyncBridge } from "./v2/boulder-sync.js";
import type { DuePollerRefreshResult } from "./v2/due-poller.js";
import {
	describeSchedule,
	formatActiveTasks,
	formatAvailableDefinitions,
} from "./v2/format-list.js";
import { formatTimestamp } from "./v2/format-timestamp.js";
import type { LoopV2Core } from "./v2/loop-core.js";
import type { SharedDeleteResult } from "./v2/model.js";
import type { ParsedLoopV2Command } from "./v2/parse-v2-command.js";
import { loopV2HelpText } from "./v2/parse-v2-command.js";
import type { UserLoopV2Commands } from "./v2/user-commands.js";

export type LoopV2Runtime = {
	core: LoopV2Core;
	user: UserLoopV2Commands;
	actions: AiSessionActions;
	poller:
		| { start(): void; reschedule(): DuePollerRefreshResult; dispose(): void }
		| undefined;
	boulderSync: BoulderSyncBridge | undefined;
	cwd: string;
	sessionManager: ExtensionContext["sessionManager"];
	sessionId: string;
};

export function handleLoopCommand(
	pi: ExtensionAPI,
	command: ParsedLoopV2Command,
	rt: LoopV2Runtime,
	ctx: ExtensionCommandContext,
	reschedule: () => string | undefined,
): void {
	switch (command.kind) {
		case "help":
			notify(ctx, loopV2HelpText(), "info");
			return;
		case "list":
			notify(ctx, formatActiveTasks(rt.core.listActive()), "info");
			return;
		case "available":
			notify(
				ctx,
				formatAvailableDefinitions(rt.user.listAvailable(command.scopes)),
				"info",
			);
			return;
		case "add": {
			const task = rt.user.addSessionTask({
				prompt: command.prompt,
				schedule: command.schedule,
				...(command.inhibitBoulder !== undefined
					? { inhibitBoulder: command.inhibitBoulder }
					: {}),
			});
			notify(
				ctx,
				`Scheduled session task ${task.id}: ${describeSchedule(task.schedule)}.`,
				"info",
			);
			break;
		}
		case "define": {
			const definition = rt.user.defineSharedTask(command.scope, {
				prompt: command.prompt,
				schedule: command.schedule,
				...(command.inhibitBoulder !== undefined
					? { inhibitBoulder: command.inhibitBoulder }
					: {}),
			});
			notify(
				ctx,
				`Defined shared ${definition.scope} definition ${definition.id}: ${describeSchedule(definition.schedule)}.`,
				"info",
			);
			break;
		}
		case "register": {
			const registration = rt.user.registerSharedTask(
				command.scope,
				command.definitionId,
			);
			notify(ctx, `Registered ${registration.id}.`, "info");
			break;
		}
		case "unregister": {
			const outcome = rt.user.unregisterSharedTask(command.registrationId);
			notify(
				ctx,
				outcome === "cancelled"
					? `Unregistered ${command.registrationId}.`
					: `Cannot unregister ${command.registrationId}: ${outcome}.`,
				outcome === "cancelled" ? "info" : "warning",
			);
			break;
		}
		case "stop":
			notify(
				ctx,
				command.target === "all" ? stopAll(rt) : stopOne(rt, command.target),
				"info",
			);
			break;
		case "delete": {
			const outcome = rt.user.deleteSharedTask(
				command.scope,
				command.definitionId,
				command.force,
			);
			notify(
				ctx,
				deleteMessage(command.definitionId, outcome),
				outcome.kind === "deleted" ? "info" : "warning",
			);
			break;
		}
		case "run":
			runPromptNow(pi, rt, command.id, ctx);
			break;
		case "defer": {
			const outcome = rt.user.deferActiveTask(command.id, command.time);
			if (outcome.kind !== "deferred") {
				notify(
					ctx,
					`Cannot defer ${command.id}: ${outcome.kind === "invalid-time" ? outcome.message : outcome.kind}.`,
					"warning",
				);
				return;
			}
			notify(
				ctx,
				`Deferred ${command.id} until ${formatTimestamp(outcome.nextRunAt)} (next delivery only; schedule unchanged).`,
				"info",
			);
			break;
		}
		case "error":
			notify(ctx, command.message, "warning");
			return;
	}
	const refreshError = reschedule();
	if (typeof refreshError === "string") notify(ctx, refreshError, "error");
}

function stopAll(rt: LoopV2Runtime): string {
	let stopped = 0;
	for (const id of [...rt.core.activeIds()]) {
		if (rt.core.cancelActive(id) === "cancelled") stopped += 1;
	}
	return `Stopped ${stopped} active task${stopped === 1 ? "" : "s"}.`;
}

function stopOne(rt: LoopV2Runtime, target: string): string {
	const outcome = rt.core.cancelActive(target);
	return outcome === "cancelled"
		? `Stopped ${target}.`
		: `Cannot stop ${target}: ${outcome}.`;
}

function deleteMessage(id: string, outcome: SharedDeleteResult): string {
	switch (outcome.kind) {
		case "deleted":
			return `Deleted shared definition ${id}.`;
		case "missing":
			return `No shared definition ${id}.`;
		case "registered-by-others":
			return `${id} is registered by another session. Use /loop delete --force ${id} to remove it anyway.`;
		default:
			return `${id} is busy. Try again.`;
	}
}
