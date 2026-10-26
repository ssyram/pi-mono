import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "./format-duration.js";
import type { RunningTask } from "./task-dispatcher.js";
import type { ActiveTask } from "./v2/model.js";

export type LoopWidgetItem = {
	id: string;
	name?: string | undefined;
	nextRunAt?: number;
	running?: RunningTask;
};

export function collectLoopWidgetItems(
	active: readonly ActiveTask[],
	running: readonly RunningTask[],
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
		let line: string;
		if (item.running) {
			const { success, completed, total, current } = item.running;
			const command = current
				? `${current.path} ${current.params.map((param) => JSON.stringify(param)).join(" ")}`
				: "Finishing";
			line = `Running (${success}/${completed}/${total}) ${command} · ${label}`;
		} else {
			const remaining =
				Math.max(0, Math.ceil(((item.nextRunAt ?? now) - now) / 1000)) * 1000;
			line = `Waiting ${formatDuration(remaining)} · ${label}`;
		}
		return truncateToWidth(line.replace(/\p{Cc}/gu, " "), width);
	});
}
