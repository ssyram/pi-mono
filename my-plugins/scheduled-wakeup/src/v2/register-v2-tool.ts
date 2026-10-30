import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loopErrorMessage } from "../loop-error-message.js";
import { notifyLoop } from "../loop-notification.js";
import { parseAtTime } from "../parse-at-time.js";
import { parseDuration } from "../parse-duration.js";
import { prepareScriptTask } from "../script-tasks/prepare-task.js";
import type {
	AiSessionActionResult,
	AiSessionActions,
} from "./ai-session-actions.js";
import type { TaskSchedule } from "./model.js";
import {
	ScheduledWakeupParams,
	type ToolParams,
} from "./scheduled-wakeup-schema.js";

export type ScheduledWakeupV2ToolOptions = {
	getActions: (ctx: ExtensionContext) => AiSessionActions;
	validateAdd?: (ctx: ExtensionContext) => string | undefined;
	/** Called after every mutating action (add/cancel/delete) so the poller can reschedule. */
	onMutation: () => string | undefined;
	now?: () => number;
};

export function registerScheduledWakeupV2Tool(
	pi: ExtensionAPI,
	options: ScheduledWakeupV2ToolOptions,
): void {
	pi.registerTool({
		name: "scheduled_wakeup",
		label: "Scheduled Wakeup",
		description:
			"Schedule, list, or cancel session wakeups, or delete a registration's shared definition, using the same Loop 2.0 state as /loop.",
		promptSnippet:
			"scheduled_wakeup: schedule/list/cancel timed future prompts shared with the /loop command.",
		promptGuidelines: [
			"Use scheduled_wakeup when you need Pi to resume later or run scheduled scripts. scriptTask runs every script, then applies its wakeUp policy; timeout defaults to 1800 seconds, null is unlimited.",
			"Use exactly one of delay, at, or interval for action=add: delay/at are one-shot, interval is recurring.",
			"AI actions are session-scoped: scope and force are not available; action=delete only removes a definition via your own registration id.",
		],
		parameters: ScheduledWakeupParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const toolParams = params as ToolParams;
			let result: AiSessionActionResult;
			try {
				const error =
					toolParams.action === "add" ? options.validateAdd?.(ctx) : undefined;
				if (error !== undefined) {
					notifyLoop(ctx, error, "error");
					return {
						content: [{ type: "text", text: `Error: ${error}` }],
						details: { ok: false, message: `Error: ${error}`, active: null },
						isError: true,
					};
				}
				result = await runAction(
					toolParams,
					options.getActions(ctx),
					options,
					ctx.cwd,
				);
			} catch (error) {
				result = {
					ok: false,
					message: `Error: ${loopErrorMessage(error)}. State may already have changed.`,
					active: null,
				};
			}
			if (toolParams.action !== "list") {
				try {
					const refreshError = options.onMutation();
					if (typeof refreshError === "string")
						result = {
							...result,
							message: `${result.message} Schedule refresh failed: ${refreshError}.`,
						};
				} catch (error) {
					result = {
						...result,
						message: `${result.message} Schedule refresh failed: ${loopErrorMessage(error)}.`,
					};
				}
			}
			return {
				content: [{ type: "text", text: result.message }],
				details: result,
				isError: !result.ok,
			};
		},
	});
}

async function runAction(
	params: ToolParams,
	actions: AiSessionActions,
	options: ScheduledWakeupV2ToolOptions,
	cwd: string,
): Promise<AiSessionActionResult> {
	if (params.action === "add") {
		const converted = convertSchedule(params, options.now?.() ?? Date.now());
		if (typeof converted === "string") return failure(actions, converted);
		if (Object.hasOwn(params, "scriptTask")) {
			if (params.prompt !== undefined)
				return failure(
					actions,
					"Error: use either prompt or scriptTask, not both.",
				);
			const prepared = prepareScriptTask(params.scriptTask, cwd);
			if (!prepared.ok) return failure(actions, `Error: ${prepared.error}`);
			return await actions.execute({
				...params,
				scriptTask: prepared.task,
				schedule: converted,
			});
		}
		return await actions.execute({ ...params, schedule: converted });
	}
	return await actions.execute({ ...params });
}

/** Returns the TaskSchedule, or an error message string when the time input is unusable. */
function convertSchedule(
	params: ToolParams,
	now: number,
): TaskSchedule | string {
	const provided = [params.delay, params.at, params.interval].filter(
		(value) => value !== undefined,
	).length;
	if (provided !== 1)
		return "Error: action=add requires exactly one of delay, at, or interval.";
	if (params.delay !== undefined) {
		const delayMs = parseDuration(params.delay);
		return delayMs === undefined
			? `Error: invalid delay "${params.delay}". Use forms like 10s, 5m, 2h, 1d (or 10sec, 10min).`
			: { kind: "once", runAt: now + delayMs };
	}
	if (params.interval !== undefined) {
		const intervalMs = parseDuration(params.interval);
		return intervalMs === undefined
			? `Error: invalid interval "${params.interval}". Use forms like 10s, 5m, 2h, 1d (or 10sec, 10min).`
			: { kind: "interval", intervalMs };
	}
	const runAt = parseAtTime(params.at as string, new Date(now));
	return runAt === undefined
		? `Error: invalid or past at "${params.at as string}". Examples: 12am tomorrow, 09:30 +08:00, 2026-08-05T00:00:00Z.`
		: { kind: "once", runAt };
}

async function failure(
	actions: AiSessionActions,
	message: string,
): Promise<AiSessionActionResult> {
	const list = await actions.execute({ action: "list" });
	return {
		ok: false,
		message,
		active: list.active,
	};
}
