import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { notifyLoop as notify } from "./loop-notification.js";
import type { RunningWidget } from "./loop-running-widget.js";
import { LOOP_WIDGET_VISIBILITY } from "./loop-widget-visibility.js";
import { runPromptNow } from "./run-prompt-now.js";
import type { TaskDispatcher } from "./task-dispatcher.js";
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
import {
	activeTaskCandidates,
	definitionCandidates,
	registrationCandidates,
	resolveTarget,
	scopeOfDefinitionId,
	sessionTaskCandidates,
} from "./v2/resolve-target.js";
import { cloneTaskContent } from "./v2/task-content.js";
import type { UserLoopV2Commands } from "./v2/user-commands.js";

export type LoopV2Runtime = {
	core: LoopV2Core;
	dispatcher: TaskDispatcher;
	widget: RunningWidget;
	dispose(): void;
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
		case "show":
			pi.appendEntry(LOOP_WIDGET_VISIBILITY, { visible: command.visible });
			rt.widget.setVisible(command.visible);
			notify(
				ctx,
				`Loop widget display ${command.visible ? "on" : "off"} (session only; tasks unchanged).`,
				"info",
			);
			return;
		case "running":
			void rt.widget.show();
			return;
		case "list":
			notify(
				ctx,
				formatActiveTasks(
					rt.core.listActive(),
					rt.dispatcher.list(),
					rt.dispatcher.deliveryStatus(),
					Date.now(),
				),
				"info",
			);
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
				...cloneTaskContent(command),
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
				...cloneTaskContent(command),
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
			const resolution = resolveTarget(
				command.definitionId,
				definitionCandidates(rt.core, [command.scope]),
			);
			if (!resolution.ok) {
				notify(
					ctx,
					`Cannot register ${command.definitionId}: ${resolution.message}.`,
					"warning",
				);
				return;
			}
			const registration = rt.user.registerSharedTask(
				command.scope,
				resolution.id,
			);
			notify(ctx, `Registered ${registration.id}.`, "info");
			break;
		}
		case "unregister": {
			const resolution = resolveTarget(
				command.registrationId,
				registrationCandidates(rt.core),
			);
			if (!resolution.ok) {
				notify(
					ctx,
					`Cannot unregister ${command.registrationId}: ${resolution.message}.`,
					"warning",
				);
				return;
			}
			const outcome = rt.user.unregisterSharedTask(resolution.id);
			notify(
				ctx,
				outcome === "cancelled"
					? `Unregistered ${resolution.id}.`
					: `Cannot unregister ${command.registrationId}: ${outcome}.`,
				outcome === "cancelled" ? "info" : "warning",
			);
			break;
		}
		case "stop":
			void (async () => {
				const message =
					command.target === "all"
						? await stopAll(rt)
						: await stopOne(rt, command.target);
				notify(ctx, message, "info");
			})();
			break;
		case "delete": {
			const resolution =
				command.scope === undefined
					? resolveTarget(
								command.definitionId,
								definitionCandidates(rt.core),
						)
					: { ok: true as const, id: command.definitionId };
			if (!resolution.ok) {
				notify(
					ctx,
					`Cannot delete ${command.definitionId}: ${resolution.message}.`,
					"warning",
				);
				return;
			}
			const scope = command.scope ?? scopeOfDefinitionId(resolution.id);
			if (scope === undefined) {
				notify(
					ctx,
					`Cannot delete ${resolution.id}: expected a "workspace:" or "global:" id.`,
					"warning",
				);
				return;
			}
			const outcome = rt.user.deleteSharedTask(
				scope,
				resolution.id,
				command.force,
			);
			notify(
				ctx,
				deleteMessage(resolution.id, outcome),
				outcome.kind === "deleted" ? "info" : "warning",
			);
			break;
		}
		case "run": {
			const resolution = resolveTarget(
				command.id,
				activeTaskCandidates(rt.core),
			);
			if (!resolution.ok) {
				notify(
					ctx,
					`Cannot run ${command.id}: ${resolution.message}.`,
					"warning",
				);
				return;
			}
			runPromptNow(pi, rt, resolution.id, ctx);
			break;
		}
		case "defer": {
			const resolution = resolveTarget(
				command.id,
				activeTaskCandidates(rt.core),
			);
			if (!resolution.ok) {
				notify(
					ctx,
					`Cannot defer ${command.id}: ${resolution.message}.`,
					"warning",
				);
				return;
			}
			const outcome = rt.user.deferActiveTask(resolution.id, command.time);
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
				`Deferred ${resolution.id} until ${formatTimestamp(outcome.nextRunAt)} (next delivery only; schedule unchanged).`,
				"info",
			);
			break;
		}
		case "rename": {
			const outcome = renameTarget(rt, command);
			notify(ctx, outcome.message, outcome.ok ? "info" : "warning");
			if (!outcome.ok) return;
			break;
		}
		case "error":
			notify(ctx, command.message, "warning");
			return;
	}
	const refreshError = reschedule();
	if (typeof refreshError === "string") notify(ctx, refreshError, "error");
}

async function stopAll(rt: LoopV2Runtime): Promise<string> {
	let stopped = 0;
	for (const id of [...rt.core.activeIds()]) {
		if (rt.core.cancelActive(id) === "cancelled") stopped += 1;
	}
	let killed = 0;
	let retracted = 0;
	for (const taskId of new Set(rt.dispatcher.liveRuns().map((view) => view.taskId))) {
		const termination = await rt.dispatcher.terminateTaskRuns(taskId);
		killed += termination.killed;
		retracted += termination.retracted;
	}
	return `Stopped ${stopped} active task${stopped === 1 ? "" : "s"}.${terminationSuffix(killed, retracted)}`;
}

async function stopOne(rt: LoopV2Runtime, target: string): Promise<string> {
	const activeIds = new Set(
		activeTaskCandidates(rt.core).map((candidate) => candidate.id),
	);
	const runCandidates = [...new Set(rt.dispatcher.liveRuns().map((view) => view.taskId))]
		.filter((id) => !activeIds.has(id))
		.map((id) => ({ id }));
	const resolution = resolveTarget(target, [
		...activeTaskCandidates(rt.core),
		...runCandidates,
	]);
	if (!resolution.ok) return `Cannot stop ${target}: ${resolution.message}.`;
	const outcome = rt.core.cancelActive(resolution.id);
	const termination = await rt.dispatcher.terminateTaskRuns(resolution.id);
	if (outcome !== "cancelled" && termination.killed + termination.retracted === 0)
		return `Cannot stop ${target}: ${outcome}.`;
	const head =
		outcome === "cancelled"
			? `Stopped ${resolution.id}.`
			: `Stopped runs of ${resolution.id}.`;
	return `${head}${terminationSuffix(termination.killed, termination.retracted)}`;
}

function terminationSuffix(killed: number, retracted: number): string {
	const parts: string[] = [];
	if (killed > 0)
		parts.push(`Killed ${killed} running batch${killed === 1 ? "" : "es"}.`);
	if (retracted > 0)
		parts.push(
			`Retracted ${retracted} pending deliver${retracted === 1 ? "y" : "ies"}.`,
		);
	return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function renameTarget(
	rt: LoopV2Runtime,
	command: { target: string; name: string | undefined },
): { ok: boolean; message: string } {
	const candidates = [
		...sessionTaskCandidates(rt.core),
		...definitionCandidates(rt.core),
	];
	const resolution = resolveTarget(command.target, candidates);
	if (!resolution.ok)
		return {
			ok: false,
			message: `Cannot rename ${command.target}: ${resolution.message}.`,
		};
	const scope = scopeOfDefinitionId(resolution.id);
	const renamed =
		scope === undefined
			? rt.user.renameSessionTask(resolution.id, command.name)
			: rt.user.renameSharedTask(scope, resolution.id, command.name);
	if (renamed === undefined)
		return { ok: false, message: `No renameable task ${resolution.id}.` };
	return {
		ok: true,
		message:
			command.name === undefined
				? `Cleared the name of ${resolution.id}.`
				: `Named ${resolution.id} "${command.name}".`,
	};
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
