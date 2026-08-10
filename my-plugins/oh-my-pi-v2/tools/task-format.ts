import { isUnblocked } from "./task-dependencies.js";
import type { Task } from "./task-types.js";

export function statusTag(task: Task, allTasks: Task[]): string {
	if (task.status === "done") return "[done]";
	if (task.status === "expired") return "[expired]";
	if (task.status === "in_progress") return "[in_progress]";
	if (!isUnblocked(task, allTasks)) return "[blocked]";
	return "[ready]";
}

export function formatTaskContent(task: Task): string {
	if (task.status !== "expired") return task.text;
	const reason = task.expireReason?.trim() || "no reason";
	return `${task.text} [${reason}]`;
}

export function formatTaskList(tasks: Task[]): string {
	if (tasks.length === 0) return "No tasks";
	const lines: string[] = [];
	for (const task of tasks) {
		const tag = statusTag(task, tasks);
		let line = `${tag} #${task.id}: ${formatTaskContent(task)}`;
		if (task.blockedBy.length > 0) {
			const active = task.blockedBy.filter((id) => {
				const dependency = tasks.find((candidate) => candidate.id === id);
				return dependency && dependency.status !== "done" && dependency.status !== "expired";
			});
			if (active.length > 0) line += ` (blocked by: ${active.map((id) => `#${id}`).join(", ")})`;
		}
		lines.push(line);
	}
	return lines.join("\n");
}
