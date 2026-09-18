import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { executeTaskRequest } from "../tools/task-system/execute.js";
import type { TaskRecord, TaskState } from "../tools/task-system/model.js";
export function task(
	id: number,
	status: TaskRecord["status"] = "pending",
	blockedBy: number[] = [],
): TaskRecord {
	return {
		id,
		text: `task ${id}`,
		status,
		blocks: [],
		blockedBy,
		createdAt: 1,
		updatedAt: 1,
	};
}
export function state(...tasks: TaskRecord[]): TaskState {
	for (const item of tasks)
		for (const id of item.blockedBy)
			tasks.find((candidate) => candidate.id === id)?.blocks.push(item.id);
	return { tasks, nextId: Math.max(0, ...tasks.map((item) => item.id)) + 1 };
}
export function entry(snapshot: TaskState): SessionEntry {
	return {
		type: "custom",
		customType: "omp-task-state",
		id: "snapshot",
		parentId: null,
		timestamp: "2026-01-01T00:00:00Z",
		data: snapshot,
	};
}
export function text(operation: ReturnType<typeof executeTaskRequest>): string {
	return operation.result.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}
