import type { Task } from "./task-helpers.js";

export interface TaskStateEntry {
	tasks: Task[];
	nextId: number;
}

const TASK_STATUSES = ["pending", "in_progress", "done", "expired"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

export function cloneTasks(tasks: Task[]): Task[] {
	return tasks.map((task) => ({
		...task,
		blocks: [...task.blocks],
		blockedBy: [...task.blockedBy],
	}));
}

export function validateTaskStateEntryData(data: unknown): TaskStateEntry | undefined {
	if (!isRecord(data)) return undefined;
	if (!Array.isArray(data.tasks) || typeof data.nextId !== "number") return undefined;
	if (!Number.isInteger(data.nextId) || data.nextId < 1) return undefined;

	const tasks: Task[] = [];
	const ids = new Set<number>();
	for (const value of data.tasks) {
		const task = parseTask(value);
		if (!task || ids.has(task.id)) return undefined;
		ids.add(task.id);
		tasks.push(task);
	}

	const maxId = tasks.reduce((max, task) => Math.max(max, task.id), 0);
	if (data.nextId <= maxId) return undefined;
	if (!dependenciesReferenceExistingTasks(tasks, ids)) return undefined;
	if (!hasReciprocalDependencies(tasks)) return undefined;
	if (hasDependencyCycle(tasks)) return undefined;

	return { tasks, nextId: data.nextId };
}

function parseTask(value: unknown): Task | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.id !== "number" || !Number.isInteger(value.id) || value.id < 1) return undefined;
	if (typeof value.text !== "string" || value.text.trim().length === 0) return undefined;
	if (!isTaskStatus(value.status)) return undefined;
	if (!isNumberArray(value.blocks) || !isNumberArray(value.blockedBy)) return undefined;
	if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || value.updatedAt < value.createdAt) return undefined;
	if (value.expireReason !== undefined && typeof value.expireReason !== "string") return undefined;
	return {
		id: value.id,
		text: value.text,
		status: value.status,
		blocks: [...value.blocks],
		blockedBy: [...value.blockedBy],
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		expireReason: value.expireReason,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isTaskStatus(value: unknown): value is TaskStatus {
	return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}

function isNumberArray(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isInteger(item) && item > 0);
}

function isTimestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function dependenciesReferenceExistingTasks(tasks: Task[], ids: Set<number>): boolean {
	for (const task of tasks) {
		for (const id of [...task.blocks, ...task.blockedBy]) {
			if (id === task.id || !ids.has(id)) return false;
		}
	}
	return true;
}

function hasReciprocalDependencies(tasks: Task[]): boolean {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	for (const task of tasks) {
		for (const blockedId of task.blocks) {
			if (!byId.get(blockedId)?.blockedBy.includes(task.id)) return false;
		}
		for (const blockerId of task.blockedBy) {
			if (!byId.get(blockerId)?.blocks.includes(task.id)) return false;
		}
	}
	return true;
}

function hasDependencyCycle(tasks: Task[]): boolean {
	const blockedBy = new Map(tasks.map((task) => [task.id, task.blockedBy]));
	for (const task of tasks) {
		const visited = new Set<number>();
		const queue = [...task.blockedBy];
		while (queue.length > 0) {
			const id = queue.shift();
			if (id === undefined) continue;
			if (id === task.id) return true;
			if (visited.has(id)) continue;
			visited.add(id);
			queue.push(...(blockedBy.get(id) ?? []));
		}
	}
	return false;
}
