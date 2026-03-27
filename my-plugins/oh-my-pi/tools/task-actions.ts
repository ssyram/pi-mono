/**
 * Task tool execute actions — pure functions that mutate the tasks array
 * and return tool results. No framework dependencies.
 */

import type { Task, TaskDetails } from "./task-helpers.js";
import { formatTaskList, isUnblocked } from "./task-helpers.js";

type OkFn = (text: string, action: TaskDetails["action"], tasks: Task[], nextId: number) => {
	content: [{ type: "text"; text: string }];
	details: TaskDetails;
};

type ErrFn = (action: TaskDetails["action"], error: string, tasks: Task[], nextId: number) => {
	content: [{ type: "text"; text: string }];
	details: TaskDetails;
};

const ok: OkFn = (text, action, tasks, nextId) => ({
	content: [{ type: "text" as const, text }],
	details: { action, tasks: [...tasks], nextId } as TaskDetails,
});

const err: ErrFn = (action, error, tasks, nextId) => ({
	content: [{ type: "text" as const, text: `Error: ${error}` }],
	details: { action, tasks: [...tasks], nextId, error } as TaskDetails,
});

export function executeList(tasks: Task[], nextId: number) {
	return ok(formatTaskList(tasks), "list", tasks, nextId);
}

export function executeAdd(text: string | undefined, tasks: Task[], nextId: number) {
	if (!text) return err("add", "text is required for add", tasks, nextId);
	const now = Date.now();
	tasks.push({
		id: nextId++, text, status: "pending",
		blocks: [], blockedBy: [], createdAt: now, updatedAt: now,
	});
	const addedId = tasks[tasks.length - 1].id;
	return { result: ok(`#${addedId}`, "add", tasks, nextId), nextId };
}

export function executeStart(id: number | undefined, tasks: Task[], nextId: number) {
	if (id === undefined) return err("start", "id is required for start", tasks, nextId);
	const task = tasks.find((t) => t.id === id);
	if (!task) return err("start", `task #${id} not found`, tasks, nextId);
	if (!isUnblocked(task, tasks)) {
		const blockers = task.blockedBy.filter((bid) => {
			const dep = tasks.find((d) => d.id === bid);
			return dep && dep.status !== "done" && dep.status !== "expired";
		});
		return err("start", `task #${id} is blocked by: ${blockers.map((b) => `#${b}`).join(", ")}`, tasks, nextId);
	}
	task.status = "in_progress";
	task.updatedAt = Date.now();
	return ok(`#${id}`, "start", tasks, nextId);
}

export function executeDoneOrExpire(
	action: "done" | "expire", id: number | undefined, tasks: Task[], nextId: number,
) {
	if (id === undefined) return err(action, `id is required for ${action}`, tasks, nextId);
	const task = tasks.find((t) => t.id === id);
	if (!task) return err(action, `task #${id} not found`, tasks, nextId);
	task.status = action === "done" ? "done" : "expired";
	task.updatedAt = Date.now();
	return ok(`#${id}`, action, tasks, nextId);
}

export function executeUpdateDeps(
	params: { id?: number; blocks?: number[]; blockedBy?: number[] },
	tasks: Task[], nextId: number,
) {
	if (params.id === undefined) return err("update_deps", "id is required", tasks, nextId);
	const task = tasks.find((t) => t.id === params.id);
	if (!task) return err("update_deps", `task #${params.id} not found`, tasks, nextId);

	const allIds = new Set(tasks.map((t) => t.id));
	const newBlocks = params.blocks ?? task.blocks;
	const newBlockedBy = params.blockedBy ?? task.blockedBy;
	const now = Date.now();

	for (const id of newBlocks) {
		if (!allIds.has(id)) return err("update_deps", `blocks references non-existent task #${id}`, tasks, nextId);
		if (id === task.id) return err("update_deps", "a task cannot block itself", tasks, nextId);
	}
	for (const id of newBlockedBy) {
		if (!allIds.has(id)) return err("update_deps", `blockedBy references non-existent task #${id}`, tasks, nextId);
		if (id === task.id) return err("update_deps", "a task cannot be blocked by itself", tasks, nextId);
	}

	// Remove old reverse edges
	for (const id of task.blocks) {
		const o = tasks.find((t) => t.id === id);
		if (o) { o.blockedBy = o.blockedBy.filter((b) => b !== task.id); o.updatedAt = now; }
	}
	for (const id of task.blockedBy) {
		const o = tasks.find((t) => t.id === id);
		if (o) { o.blocks = o.blocks.filter((b) => b !== task.id); o.updatedAt = now; }
	}
	task.blocks = newBlocks;
	task.blockedBy = newBlockedBy;
	task.updatedAt = now;
	// Add new reverse edges
	for (const id of newBlocks) {
		const o = tasks.find((t) => t.id === id);
		if (o && !o.blockedBy.includes(task.id)) { o.blockedBy.push(task.id); o.updatedAt = now; }
	}
	for (const id of newBlockedBy) {
		const o = tasks.find((t) => t.id === id);
		if (o && !o.blocks.includes(task.id)) { o.blocks.push(task.id); o.updatedAt = now; }
	}
	return ok(`#${params.id}`, "update_deps", tasks, nextId);
}

export function executeClear() {
	return {
		content: [{ type: "text" as const, text: "cleared" }],
		details: { action: "clear" as const, tasks: [], nextId: 1 } as TaskDetails,
	};
}
