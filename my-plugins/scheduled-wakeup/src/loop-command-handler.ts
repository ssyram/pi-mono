import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AiSessionActions } from "./v2/ai-session-actions.js";
import { describeSchedule, formatActiveTasks, formatAvailableDefinitions } from "./v2/format-list.js";
import type { LoopV2Core } from "./v2/loop-core.js";
import type { SharedDeleteResult } from "./v2/model.js";
import { loopV2HelpText } from "./v2/parse-v2-command.js";
import type { ParsedLoopV2Command } from "./v2/parse-v2-command.js";
import type { UserLoopV2Commands } from "./v2/user-commands.js";

export type LoopV2Runtime = {
	core: LoopV2Core;
	user: UserLoopV2Commands;
	actions: AiSessionActions;
	poller: { start(): void; reschedule(): void; dispose(): void } | undefined;
	cwd: string;
};

export function handleLoopCommand(pi: ExtensionAPI, command: ParsedLoopV2Command, rt: LoopV2Runtime, ctx: ExtensionCommandContext, reschedule: () => void): void {
	switch (command.kind) {
		case "help":
			notify(ctx, loopV2HelpText(), "info");
			return;
		case "list":
			notify(ctx, formatActiveTasks(rt.core.listActive()), "info");
			return;
		case "available":
			notify(ctx, formatAvailableDefinitions(rt.user.listAvailable(command.scopes)), "info");
			return;
		case "add": {
			const task = rt.user.addSessionTask({ prompt: command.prompt, schedule: command.schedule });
			notify(ctx, `Scheduled session task ${task.id}: ${describeSchedule(task.schedule)}.`, "info");
			break;
		}
		case "define": {
			const definition = rt.user.defineSharedTask(command.scope, { prompt: command.prompt, schedule: command.schedule });
			notify(ctx, `Defined shared ${definition.scope} definition ${definition.id}: ${describeSchedule(definition.schedule)}.`, "info");
			break;
		}
		case "register": {
			const registration = rt.user.registerSharedTask(command.scope, command.definitionId);
			notify(ctx, `Registered ${registration.id}.`, "info");
			break;
		}
		case "unregister": {
			const outcome = rt.user.unregisterSharedTask(command.registrationId);
			notify(ctx, outcome === "cancelled" ? `Unregistered ${command.registrationId}.` : `Cannot unregister ${command.registrationId}: ${outcome}.`, outcome === "cancelled" ? "info" : "warning");
			break;
		}
		case "stop":
			notify(ctx, command.target === "all" ? stopAll(rt) : stopOne(rt, command.target), "info");
			break;
		case "delete": {
			const outcome = rt.user.deleteSharedTask(command.scope, command.definitionId, command.force);
			notify(ctx, deleteMessage(command.definitionId, outcome), outcome.kind === "deleted" ? "info" : "warning");
			break;
		}
		case "run":
			runNow(pi, rt, command.id, ctx);
			break;
		case "error":
			notify(ctx, command.message, "warning");
			return;
	}
	reschedule();
}

function runNow(pi: ExtensionAPI, rt: LoopV2Runtime, id: string, ctx: ExtensionCommandContext): void {
	const active = rt.core.listActive().find((item) => (item.kind === "session" ? item.task.definition.id : item.registration.id) === id);
	let prompt: string | undefined;
	if (active !== undefined && active.kind === "session") prompt = active.task.definition.prompt;
	if (active !== undefined && active.kind === "registration" && active.definition !== undefined) prompt = active.definition.prompt;
	if (active === undefined || prompt === undefined) {
		notify(ctx, `No runnable active task ${id}.`, "warning");
		return;
	}
	try {
		deliver(pi, ctx, prompt);
		notify(ctx, `Delivered ${id}.`, "info");
	} catch (error) {
		notify(ctx, `Delivery of ${id} failed: ${String(error)}`, "error");
	}
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
	return outcome === "cancelled" ? `Stopped ${target}.` : `Cannot stop ${target}: ${outcome}.`;
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

function deliver(pi: ExtensionAPI, ctx: ExtensionCommandContext, prompt: string): void {
	if (ctx.isIdle()) pi.sendUserMessage(prompt);
	else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}

function notify(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
}
