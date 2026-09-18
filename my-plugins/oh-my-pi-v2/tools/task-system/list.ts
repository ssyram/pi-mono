import { formatTaskContent } from "../task-format.js";
import type { TaskListType, TaskRecord, TaskRow } from "./model.js";

export function taskRow(task: TaskRecord, all: readonly TaskRecord[]): TaskRow {
	const blockers = task.blockedBy.filter((id) => {
		const dependency = all.find((candidate) => candidate.id === id);
		return (
			!dependency ||
			(dependency.status !== "done" && dependency.status !== "expired")
		);
	});
	const status =
		task.status === "pending"
			? blockers.length
				? "blocked"
				: "ready"
			: task.status;
	return {
		task: { ...task, blocks: [...task.blocks], blockedBy: [...task.blockedBy] },
		status,
		blockers,
	};
}
function closed(task: TaskRecord): boolean {
	return task.status === "done" || task.status === "expired";
}
function closedOrder(left: TaskRecord, right: TaskRecord): number {
	return (
		(right.closedOrder ?? 0) - (left.closedOrder ?? 0) || right.id - left.id
	);
}
export function selectTaskRows(
	tasks: readonly TaskRecord[],
	type?: TaskListType,
	limit?: number,
): TaskRow[] {
	if (
		limit !== undefined &&
		(type === undefined || !Number.isSafeInteger(limit) || limit < 0)
	) {
		throw new Error(
			"limit requires an explicit type and a nonnegative safe integer",
		);
	}
	const rows = tasks.map((task) => taskRow(task, tasks));
	const priority = {
		in_progress: 0,
		ready: 1,
		blocked: 2,
		done: 3,
		expired: 3,
	};
	const open = rows
		.filter((row) => !closed(row.task))
		.sort(
			(a, b) =>
				priority[a.status] - priority[b.status] || a.task.id - b.task.id,
		);
	const ended = rows
		.filter((row) => closed(row.task))
		.sort((a, b) => closedOrder(a.task, b.task));
	if (type === undefined) return [...open, ...ended.slice(0, 10)];
	const selected =
		type === "open"
			? open
			: type === "closed"
				? ended
				: [...open, ...ended].filter((row) => row.status === type);
	return limit === undefined ? selected : selected.slice(0, limit);
}
export function formatTaskRows(rows: readonly TaskRow[]): string {
	if (!rows.length) return "No tasks";
	return rows
		.map(({ task, status, blockers }) => {
			const suffix = blockers.length
				? ` (blocked by: ${blockers.map((id) => `#${id}`).join(", ")})`
				: "";
			return `[${status}] #${task.id}: ${formatTaskContent(task)}${suffix}`;
		})
		.join("\n");
}
