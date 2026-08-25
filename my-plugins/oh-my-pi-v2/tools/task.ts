import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeAdd, executeClear, executeDoneOrExpire, executeList, executeStart, executeUpdateDeps } from "./task-actions.js";
import { isUnblocked } from "./task-dependencies.js";
import { renderTaskCall, renderTaskResult } from "./task-renderers.js";
import { cloneTasks, type TaskStateEntry, validateTaskStateEntryData } from "./task-state-entry.js";
import type { Task, TaskChangeCallback, TaskDetails } from "./task-types.js";

export { CONFIRM_STOP_TAG } from "../hooks/boulder-stop-protocol.js";
export type { Task, TaskChangeCallback, TaskDetails } from "./task-types.js";
const TASK_ENTRY_TYPE = "omp-task-state";

export interface TaskToolState {
	tasks: Task[];
	pendingCount: number;
	actionableCount: number;
	inProgressCount: number;
	readyTasks: Task[];
}

export interface TaskToolHandle {
	getTaskState(context: ExtensionContext): TaskToolState;
	setOnTaskChange(callback: TaskChangeCallback): void;
}

const TaskParams = Type.Object({
	action: StringEnum(["list", "add", "start", "done", "expire", "clear", "update_deps"] as const),
	text: Type.Optional(Type.String({ description: "Task description (required for: add)" })),
	id: Type.Optional(Type.Number({ description: "Task ID (required for: start, done, expire, update_deps)" })),
	reason: Type.Optional(Type.String({ description: "Explanation (required for: expire)" })),
	blocks: Type.Optional(Type.Array(Type.Number(), { description: "Task IDs that this task blocks (for: update_deps)" })),
	blockedBy: Type.Optional(Type.Array(Type.Number(), { description: "Task IDs that block this task (for: update_deps)" })),
});

function stateFromEntry(entry: SessionEntry): TaskStateEntry | undefined {
	if (entry.type !== "custom" || entry.customType !== TASK_ENTRY_TYPE) return undefined;
	const state = validateTaskStateEntryData(entry.data);
	if (!state) console.error("[oh-my-pi task] Ignoring invalid persisted task state entry");
	return state;
}

function summarizeTaskState(state: TaskStateEntry): TaskToolState {
	const readyTasks = state.tasks.filter((task) => task.status === "pending" && isUnblocked(task, state.tasks));
	const inProgressCount = state.tasks.filter((task) => task.status === "in_progress").length;
	return {
		tasks: [...state.tasks],
		pendingCount: state.tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length,
		actionableCount: inProgressCount + readyTasks.length,
		inProgressCount,
		readyTasks,
	};
}

export function registerTaskTool(pi: ExtensionAPI): TaskToolHandle {
	const states = new WeakMap<ExtensionContext["sessionManager"], TaskStateEntry>();
	let onTaskChange: TaskChangeCallback | undefined;
	const stateFor = (context: ExtensionContext): TaskStateEntry => {
		const existing = states.get(context.sessionManager);
		if (existing) return existing;
		const created = { tasks: [], nextId: 1 };
		states.set(context.sessionManager, created);
		return created;
	};
	const notifyChange = (context: ExtensionContext, state: TaskStateEntry): void => {
		try {
			onTaskChange?.([...state.tasks], context);
		} catch (error) {
			console.error(`[oh-my-pi task] Task change callback failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	const reloadState = (context: ExtensionContext): void => {
		let loaded: TaskStateEntry | undefined;
		for (const entry of context.sessionManager.getBranch()) {
			const state = stateFromEntry(entry);
			if (state) loaded = state;
		}
		const installed = loaded
			? { tasks: cloneTasks(loaded.tasks), nextId: loaded.nextId }
			: { tasks: [], nextId: 1 };
		states.set(context.sessionManager, installed);
		notifyChange(context, installed);
	};
	const persistState = (state: TaskStateEntry): void => {
		pi.appendEntry(TASK_ENTRY_TYPE, { tasks: cloneTasks(state.tasks), nextId: state.nextId } satisfies TaskStateEntry);
	};

	pi.on("session_start", (_event, context) => reloadState(context));
	pi.on("session_tree", (_event, context) => reloadState(context));
	pi.on("session_shutdown", (_event, context) => {
		states.delete(context.sessionManager);
	});

	pi.registerTool({
		name: "task",
		label: "Task",
		description:
			"Manage the tracked task list. " +
			"Actions: list — show all tasks; add (text) — add a new pending task; " +
			"start (id) — mark task as in progress; done (id) — mark task as completed; " +
			"expire (id, reason) — mark task as stale/no longer relevant and explain why; clear — remove all tasks; " +
			"update_deps (id, blocks?, blockedBy?) — set dependency edges. " +
			"Tasks can have dependencies: a [blocked] task cannot start until its blockers are done/expired. " +
			"The loop will restart automatically if any tasks remain in_progress or ready when you stop.",
		promptSnippet: "Manage the tracked task list.",
		parameters: TaskParams,
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const state = stateFor(context);
			const previous = { tasks: cloneTasks(state.tasks), nextId: state.nextId };
			const action = params.action;
			const mutating = action !== "list";
			let result: AgentToolResult<TaskDetails>;
			switch (action) {
				case "list": result = executeList(state.tasks, state.nextId); break;
				case "add": {
					const added = executeAdd(params.text, state.tasks, state.nextId);
					if ("nextId" in added) {
						state.nextId = added.nextId;
						result = added.result;
					} else result = added;
					break;
				}
				case "start": result = executeStart(params.id, state.tasks, state.nextId); break;
				case "done": result = executeDoneOrExpire("done", params.id, undefined, state.tasks, state.nextId); break;
				case "expire": result = executeDoneOrExpire("expire", params.id, params.reason, state.tasks, state.nextId); break;
				case "update_deps": result = executeUpdateDeps(params, state.tasks, state.nextId); break;
				case "clear": state.tasks = []; state.nextId = 1; result = executeClear(); break;
				default: {
					const error = `unknown action: ${String(action)}`;
					return {
						content: [{ type: "text", text: `Error: ${error}` }],
						details: { action: "list", tasks: [...state.tasks], nextId: state.nextId, error } as TaskDetails,
					};
				}
			}
			if (mutating) {
				try {
					persistState(state);
				} catch (error) {
					states.set(context.sessionManager, previous);
					console.error(`[oh-my-pi task] Failed to persist task state: ${error instanceof Error ? error.message : String(error)}`);
					throw error;
				}
				notifyChange(context, state);
			}
			return result;
		},
		renderCall: renderTaskCall,
		renderResult: renderTaskResult,
	});

	return {
		getTaskState: (context) => summarizeTaskState(stateFor(context)),
		setOnTaskChange: (callback) => { onTaskChange = callback; },
	};
}
