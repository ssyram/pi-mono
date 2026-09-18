import type { ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { taskRow } from "./list.js";
import type { TaskRecord } from "./model.js";

export function taskAdmission(
	toolName: string,
	readTasks: () => readonly TaskRecord[],
): ToolCallEventResult | undefined {
	if (toolName === "task") return undefined;
	try {
		const tasks = readTasks();
		if (
			tasks.some(
				(task) =>
					task.status === "in_progress" &&
					taskRow(task, tasks).blockers.length === 0,
			)
		)
			return undefined;
	} catch {
		return {
			block: true,
			reason:
				"Task state could not be checked. Non-task tool refused; use task to inspect or restore state.",
		};
	}
	return {
		block: true,
		reason:
			"No unblocked task is in progress. Use task to add/start a task before calling other tools.",
	};
}
export function taskAvailabilityProblem(
	availableNames: readonly string[],
): string | undefined {
	return availableNames.includes("task")
		? undefined
		: "OMP task gate requires the task tool. The tool allowlist excludes it; allow task in the owning profile. Non-task tools remain denied without active work.";
}
