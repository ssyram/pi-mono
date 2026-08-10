import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isUnblocked } from "./task-dependencies.js";
import { formatTaskContent, statusTag } from "./task-format.js";
import type { Task } from "./task-types.js";

const MAX_DISPLAYED_TASKS = 10;
const MAX_DISPLAYED_BLOCKERS = 3;

interface TaskWidgetRow {
	content: string;
	suffix: string;
}

function displayPriority(task: Task, tasks: Task[]): number {
	if (task.status === "in_progress") return 0;
	if (task.status === "pending") return isUnblocked(task, tasks) ? 1 : 2;
	if (task.status === "done") return 3;
	return 4;
}

export function sortTasksForDisplay(tasks: Task[]): Task[] {
	return [...tasks].sort((a, b) => {
		const priorityDifference = displayPriority(a, tasks) - displayPriority(b, tasks);
		if (priorityDifference !== 0) return priorityDifference;
		if (a.status === "done" || a.status === "expired") return b.id - a.id;
		return a.id - b.id;
	});
}

export function normalizeTaskDisplayText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function buildTaskWidgetRows(tasks: Task[]): TaskWidgetRow[] {
	const sorted = sortTasksForDisplay(tasks);
	const active = tasks.filter(
		(task) => task.status === "in_progress" || (task.status === "pending" && isUnblocked(task, tasks)),
	).length;
	const done = tasks.filter((task) => task.status === "done").length;
	const rows: TaskWidgetRow[] = [{ content: `Tasks (${active} active, ${done}/${tasks.length} done)`, suffix: "" }];

	for (const task of sorted.slice(0, MAX_DISPLAYED_TASKS)) {
		const tag = statusTag(task, tasks);
		const icon =
			task.status === "done"
				? "✓"
				: task.status === "expired"
					? "✗"
					: task.status === "in_progress"
						? "➤"
						: tag === "[blocked]"
							? "○"
							: "⚡";
		const unresolvedBlockers = task.blockedBy.filter((id) => {
			const dependency = tasks.find((candidate) => candidate.id === id);
			return dependency && dependency.status !== "done" && dependency.status !== "expired";
		});
		const displayedBlockers = unresolvedBlockers.slice(0, MAX_DISPLAYED_BLOCKERS).map((id) => `#${id}`);
		const blockerOverflow = unresolvedBlockers.length > MAX_DISPLAYED_BLOCKERS ? ",…" : "";
		const suffix = tag === "[blocked]" ? ` ← ${displayedBlockers.join(",")}${blockerOverflow}` : "";
		rows.push({
			content: `  ${icon} #${task.id} ${normalizeTaskDisplayText(formatTaskContent(task))}`,
			suffix,
		});
	}

	if (sorted.length > MAX_DISPLAYED_TASKS) {
		rows.push({ content: `  ... ${sorted.length - MAX_DISPLAYED_TASKS} more`, suffix: "" });
	}
	return rows;
}

export function buildTaskWidgetLines(tasks: Task[]): string[] {
	return buildTaskWidgetRows(tasks).map((row) => row.content + row.suffix);
}

export class TaskWidgetComponent implements Component {
	private readonly tasks: Task[];

	constructor(tasks: Task[]) {
		this.tasks = tasks;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const availableWidth = Math.max(1, width);
		return buildTaskWidgetRows(this.tasks).map((row) => {
			if (row.suffix === "") return truncateToWidth(row.content, availableWidth, "…");
			const suffixWidth = visibleWidth(row.suffix);
			if (suffixWidth >= availableWidth) return truncateToWidth(row.suffix, availableWidth, "…");
			return truncateToWidth(row.content, availableWidth - suffixWidth, "…") + row.suffix;
		});
	}
}
