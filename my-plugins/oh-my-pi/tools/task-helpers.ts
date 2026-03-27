/**
 * Shared helpers for the task tool — status checks, formatting, types.
 */

// ─── Data model ──────────────────────────────────────────────────────────────

export interface Task {
	id: number;
	text: string;
	status: "pending" | "in_progress" | "done" | "expired";
	blocks: number[];
	blockedBy: number[];
	createdAt: number;
	updatedAt: number;
}

export interface TaskDetails {
	action: "list" | "add" | "start" | "done" | "expire" | "clear" | "update_deps";
	tasks: Task[];
	nextId: number;
	error?: string;
}

export type TaskChangeCallback = (tasks: Task[]) => void;

// ─── Helpers ────────────────────────────────────────────────────────────────

export function isUnblocked(task: Task, allTasks: Task[]): boolean {
	if (task.blockedBy.length === 0) return true;
	return task.blockedBy.every((depId) => {
		const dep = allTasks.find((t) => t.id === depId);
		return !dep || dep.status === "done" || dep.status === "expired";
	});
}

export function statusTag(task: Task, allTasks: Task[]): string {
	if (task.status === "done") return "[done]";
	if (task.status === "expired") return "[expired]";
	if (task.status === "in_progress") return "[in_progress]";
	if (!isUnblocked(task, allTasks)) return "[blocked]";
	return "[ready]";
}

export function findNewlyUnblocked(completedId: number, tasks: Task[]): Task[] {
	return tasks.filter((t) => {
		if (t.status !== "pending") return false;
		if (!t.blockedBy.includes(completedId)) return false;
		return isUnblocked(t, tasks);
	});
}

/** Format task list for LLM consumption (plain text, no theme). */
export function formatTaskList(tasks: Task[]): string {
	if (tasks.length === 0) return "No tasks";
	const lines: string[] = [];
	for (const t of tasks) {
		const tag = statusTag(t, tasks);
		let line = `${tag} #${t.id}: ${t.text}`;
		if (t.blockedBy.length > 0) {
			const active = t.blockedBy.filter((id) => {
				const dep = tasks.find((d) => d.id === id);
				return dep && dep.status !== "done" && dep.status !== "expired";
			});
			if (active.length > 0) line += ` (blocked by: ${active.map((id) => `#${id}`).join(", ")})`;
		}
		lines.push(line);
	}
	return lines.join("\n");
}
