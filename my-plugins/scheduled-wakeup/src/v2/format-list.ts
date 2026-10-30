import { formatDuration } from "../format-duration.js";
import {
	collectLoopWidgetItems,
	formatQueuedSuffix,
	type LoopWidgetItem,
} from "../loop-widget-items.js";
import type { RunningTask } from "../task-dispatcher.js";
import { formatTimestamp } from "./format-timestamp.js";
import type {
	ActiveTask,
	SharedDefinition,
	TaskSchedule,
} from "./model.js";
import { describeTaskContent } from "./task-content.js";

export function describeSchedule(schedule: TaskSchedule): string {
	if (schedule.kind === "interval")
		return `every ${formatDuration(schedule.intervalMs)}`;
	return `once at ${formatTimestamp(schedule.runAt)}`;
}

export function formatActiveTasks(
	active: readonly ActiveTask[],
	running: readonly RunningTask[] = [],
	deliveryStatus: ReadonlyMap<string, { wakeUps: number; noWakes: number }> = new Map(),
	now: number = Date.now(),
): string {
	const items = collectLoopWidgetItems(active, running, deliveryStatus);
	if (items.length === 0) return "No active scheduled wakeups.";
	return items.map((item) => formatItemLine(item, now)).join("\n");
}

function formatItemLine(item: LoopWidgetItem, now: number): string {
	const label = item.name === undefined ? item.id : `${item.name} [${item.id}]`;
	const queued = item.queued
		? formatQueuedSuffix(item.queued.wakeUps, item.queued.noWakes)
		: "";
	if (item.running !== undefined) {
		const { success, completed, total, current } = item.running;
		const command = current
			? `${current.path} ${current.params.map((param) => JSON.stringify(param)).join(" ")}`
			: "finishing";
		return `${label} | ${item.scope ?? "-"} | Running (${success}/${completed}/${total}) ${command}${queued}`;
	}
	if (item.pendingDelivery !== undefined && item.nextRunAt === undefined) {
		return `${label} | ${item.scope ?? "-"} | Pending delivery (${item.pendingDelivery.shouldWake ? "wake" : "no wake"})${queued}`;
	}
	const next =
		item.pausedRemaining !== undefined
			? `paused with ${formatDuration(item.pausedRemaining)} remaining`
			: item.nextRunAt === undefined
				? "-"
				: `next in ${formatDuration(Math.max(0, item.nextRunAt - now))}`;
	const schedule = item.schedule === undefined ? "-" : describeSchedule(item.schedule);
	return `${label} | ${item.scope ?? "-"} | ${schedule} | ${next} | runs ${item.runs ?? 0} | ${item.summary ?? "-"}${queued}`;
}

export function formatAvailableDefinitions(
	definitions: readonly SharedDefinition[],
): string {
	if (definitions.length === 0) return "No available shared definitions.";
	return definitions
		.map(
			(definition) =>
				`${label(definition.id, definition.name)} | ${definition.scope} | ${describeSchedule(definition.schedule)} | ${describeTaskContent(definition)}`,
		)
		.join("\n");
}

function label(id: string, name: string | undefined): string {
	return name === undefined ? id : `${name} [${id}]`;
}
