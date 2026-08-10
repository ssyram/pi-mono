import type { Task } from "./task-types.js";

export function isUnblocked(task: Task, allTasks: Task[]): boolean {
	if (task.blockedBy.length === 0) return true;
	return task.blockedBy.every((dependencyId) => {
		const dependency = allTasks.find((candidate) => candidate.id === dependencyId);
		return !dependency || dependency.status === "done" || dependency.status === "expired";
	});
}

export function findNewlyUnblocked(completedId: number, tasks: Task[]): Task[] {
	return tasks.filter((task) => {
		if (task.status !== "pending") return false;
		if (!task.blockedBy.includes(completedId)) return false;
		return isUnblocked(task, tasks);
	});
}
