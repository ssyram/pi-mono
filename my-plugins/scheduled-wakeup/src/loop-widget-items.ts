import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "./format-duration.js";
import type { DeliveryStatus, RunningTask } from "./task-dispatcher.js";
import type { ActiveTask } from "./v2/model.js";

export type LoopWidgetItem = {
	id: string;
	name?: string | undefined;
	nextRunAt?: number;
	running?: RunningTask;
	queued?: { wakeUps: number; noWakes: number };
};

export function formatQueuedSuffix(wakeUps: number, noWakes: number): string {
	if (wakeUps > 0 && noWakes > 0) return ` (${wakeUps} wake-up, ${noWakes} no-wake)`;
	if (wakeUps > 0) return ` (${wakeUps} wake-up)`;
	if (noWakes > 0) return ` (${noWakes} no-wake)`;
	return "";
}

export function collectLoopWidgetItems(
	active: readonly ActiveTask[],
	running: readonly RunningTask[],
	deliveryStatus: ReadonlyMap<string, DeliveryStatus> = new Map(),
): LoopWidgetItem[] {
	const items = new Map<string, LoopWidgetItem>();
	for (const entry of active) {
		const progress =
			entry.kind === "session"
				? entry.task.progress
				: entry.registration.progress;
		const id =
			entry.kind === "session"
				? entry.task.definition.id
				: entry.registration.id;
		const name =
			entry.kind === "session"
				? entry.task.definition.name
				: entry.definition?.name;
		if (progress.status === "active")
			items.set(id, { id, name, nextRunAt: progress.nextRunAt });
	}
	for (const entry of running)
		items.set(entry.id, {
			...items.get(entry.id),
			id: entry.id,
			running: entry,
		});
	for (const [id, counts] of deliveryStatus) {
		if (counts.wakeUps <= 0 && counts.noWakes <= 0) continue;
		items.set(id, { ...items.get(id), id, queued: counts });
	}
	return [...items.values()].sort(
		(a, b) =>
			Number(Boolean(b.running)) - Number(Boolean(a.running)) ||
			(a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity),
	);
}

export function loopWidgetLines(
	items: readonly LoopWidgetItem[],
	width: number,
	now = Date.now(),
): string[] {
	return items.map((item) => {
		const label =
			item.name === undefined ? item.id : `${item.name} · ${item.id}`;
		const queued = item.queued
			? formatQueuedSuffix(item.queued.wakeUps, item.queued.noWakes)
			: "";
		let line: string;
		if (item.running) {
			const { success, completed, total, current } = item.running;
			const command = current
				? `${current.path} ${current.params.map((param) => JSON.stringify(param)).join(" ")}`
				: "Finishing";
			line = `Running (${success}/${completed}/${total}) ${command} · ${label}${queued}`;
		} else {
			const remaining =
				Math.max(0, Math.ceil(((item.nextRunAt ?? now) - now) / 1000)) * 1000;
			line = `Waiting ${formatDuration(remaining)} · ${label}${queued}`;
		}
		return truncateToWidth(line.replace(/\p{Cc}/gu, " "), width);
	});
}
