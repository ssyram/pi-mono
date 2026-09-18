import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { validateTaskStateEntryData } from "../task-state-entry.js";
import { cloneTaskState, type TaskState } from "./model.js";

export const TASK_STATE_ENTRY_TYPE = "omp-task-state";
export function parseTaskState(data: unknown): TaskState | undefined {
	const base = validateTaskStateEntryData(data);
	if (!base || !Number.isSafeInteger(base.nextId)) return undefined;
	if (
		typeof data !== "object" ||
		data === null ||
		!("tasks" in data) ||
		!Array.isArray(data.tasks)
	)
		return undefined;
	const state: TaskState = base;
	for (let index = 0; index < state.tasks.length; index++) {
		const task = state.tasks[index];
		if (
			!Number.isSafeInteger(task.id) ||
			[...task.blocks, ...task.blockedBy].some(
				(id) => !Number.isSafeInteger(id),
			)
		)
			return undefined;
		const raw: unknown = data.tasks[index];
		if (typeof raw !== "object" || raw === null) return undefined;
		if ("closedOrder" in raw && raw.closedOrder !== undefined) {
			if (
				typeof raw.closedOrder !== "number" ||
				!Number.isSafeInteger(raw.closedOrder) ||
				raw.closedOrder < 1
			)
				return undefined;
			task.closedOrder = raw.closedOrder;
		}
	}
	return state;
}
export function restoreTaskState(
	branch: readonly SessionEntry[],
	history: readonly SessionEntry[],
	highWater = 1,
): TaskState {
	if (!Number.isSafeInteger(highWater) || highWater < 1)
		throw new Error("Invalid task allocation high-water mark");
	let state: TaskState = { tasks: [], nextId: highWater };
	for (const entry of branch) {
		if (entry.type !== "custom" || entry.customType !== TASK_STATE_ENTRY_TYPE)
			continue;
		const parsed = parseTaskState(entry.data);
		if (parsed) state = parsed;
	}
	let nextId = Math.max(highWater, state.nextId);
	for (const entry of history) {
		if (entry.type !== "custom" || entry.customType !== TASK_STATE_ENTRY_TYPE)
			continue;
		const parsed = parseTaskState(entry.data);
		if (parsed) nextId = Math.max(nextId, parsed.nextId);
	}
	return { tasks: cloneTaskState(state).tasks, nextId };
}
export function clearTaskState(state: TaskState): TaskState {
	return { tasks: [], nextId: state.nextId };
}
