import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseAtTime } from "../parse-at-time.js";
import { parseDuration } from "../parse-duration.js";
import { AiSessionActions, type AiSessionActionResult } from "./ai-session-actions.js";
import type { TaskSchedule } from "./model.js";

const ScheduledWakeupParams = Type.Object({
	action: Type.Union([Type.Literal("add"), Type.Literal("list"), Type.Literal("cancel"), Type.Literal("delete")], {
		description: "Action to perform",
	}),
	prompt: Type.Optional(Type.String({ description: "Prompt to deliver when the wakeup fires. Required for action=add." })),
	delay: Type.Optional(Type.String({ description: "One-shot relative delay such as 10s, 5m, 2h, or 1d. Use exactly one of delay, at, or interval for action=add." })),
	at: Type.Optional(Type.String({ description: "One-shot absolute clock time such as 12am tomorrow, 09:30 +08:00, or 2026-08-05T00:00:00Z." })),
	interval: Type.Optional(Type.String({ description: "Recurring interval such as 10s, 5m, 2h, or 1d." })),
	id: Type.Optional(Type.String({ description: "Active task id for action=cancel, or registration id for action=delete." })),
});

type ToolParams = {
	action: "add" | "list" | "cancel" | "delete";
	prompt?: string | undefined;
	delay?: string | undefined;
	at?: string | undefined;
	interval?: string | undefined;
	id?: string | undefined;
};

export type ScheduledWakeupV2ToolOptions = {
	getActions: (ctx: ExtensionContext) => AiSessionActions;
	/** Called after every mutating action (add/cancel/delete) so the poller can reschedule. */
	onMutation: () => void;
	now?: () => number;
};

export function registerScheduledWakeupV2Tool(pi: ExtensionAPI, options: ScheduledWakeupV2ToolOptions): void {
	pi.registerTool({
		name: "scheduled_wakeup",
		label: "Scheduled Wakeup",
		description: "Schedule, list, or cancel session wakeups, or delete a registration's shared definition, using the same Loop 2.0 state as /loop.",
		promptSnippet: "scheduled_wakeup: schedule/list/cancel timed future prompts shared with the /loop command.",
		promptGuidelines: [
			"Use scheduled_wakeup when you need Pi to resume later or periodically revisit a task.",
			"Use exactly one of delay, at, or interval for action=add: delay/at are one-shot, interval is recurring.",
			"AI actions are session-scoped: scope and force are not available; action=delete only removes a definition via your own registration id.",
		],
		parameters: ScheduledWakeupParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const actions = options.getActions(ctx);
			const toolParams = params as ToolParams;
			const result = runAction(toolParams, actions, options);
			if (toolParams.action !== "list") options.onMutation();
			return {
				content: [{ type: "text", text: result.message }],
				details: result,
			};
		},
	});
}

function runAction(params: ToolParams, actions: AiSessionActions, options: ScheduledWakeupV2ToolOptions): AiSessionActionResult {
	if (params.action === "add") {
		const converted = convertSchedule(params, options.now?.() ?? Date.now());
		if (typeof converted === "string") return failure(actions, converted);
		return actions.execute({ ...params, schedule: converted });
	}
	return actions.execute({ ...params });
}

/** Returns the TaskSchedule, or an error message string when the time input is unusable. */
function convertSchedule(params: ToolParams, now: number): TaskSchedule | string {
	const provided = [params.delay, params.at, params.interval].filter((value) => value !== undefined).length;
	if (provided !== 1) return "Error: action=add requires exactly one of delay, at, or interval.";
	if (params.delay !== undefined) {
		const delayMs = parseDuration(params.delay);
		return delayMs === undefined
			? `Error: invalid delay "${params.delay}". Use forms like 10s, 5m, 2h, 1d.`
			: { kind: "once", runAt: now + delayMs };
	}
	if (params.interval !== undefined) {
		const intervalMs = parseDuration(params.interval);
		return intervalMs === undefined
			? `Error: invalid interval "${params.interval}". Use forms like 10s, 5m, 2h, 1d.`
			: { kind: "interval", intervalMs };
	}
	const runAt = parseAtTime(params.at as string, new Date(now));
	return runAt === undefined
		? `Error: invalid or past at "${params.at as string}". Examples: 12am tomorrow, 09:30 +08:00, 2026-08-05T00:00:00Z.`
		: { kind: "once", runAt };
}

function failure(actions: AiSessionActions, message: string): AiSessionActionResult {
	return { ok: false, message, active: actions.execute({ action: "list" }).active };
}
