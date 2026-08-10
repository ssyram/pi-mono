import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Task } from "../tools/task.js";

export interface CompactionTaskState {
	tasks: Task[];
	actionableCount: number;
	readyTasks: Task[];
}

export type CompactionTaskStateReader = (context: ExtensionContext) => CompactionTaskState;

export function formatCompactionTaskContext(
	getTaskState: CompactionTaskStateReader,
	context: ExtensionContext,
): string {
	const { tasks, actionableCount, readyTasks } = getTaskState(context);
	if (actionableCount === 0) return "";

	const lines = [...tasks.filter((task) => task.status === "in_progress"), ...readyTasks]
		.map((task) => `- [#${task.id}] ${task.text} (${task.status})`)
		.join("\n");
	return `\n\n<active-tasks>\n${lines}\n</active-tasks>`;
}
