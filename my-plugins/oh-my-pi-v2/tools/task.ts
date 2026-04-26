/**
 * task tool — LLM-managed task list with agentic loop enforcement.
 *
 * State persisted as CustomEntry in session JSONL, orthogonal to LLM context.
 * CustomEntry is never deleted by compaction and never sent to LLM.
 * UI change callback for persistent TUI widget.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { executeAdd, executeClear, executeDoneOrExpire, executeList, executeStart, executeUpdateDeps } from "./task-actions.js";
import type { Task, TaskChangeCallback, TaskDetails } from "./task-helpers.js";
import { cloneTasks, type TaskStateEntry, validateTaskStateEntryData } from "./task-state-entry.js";
import { isUnblocked, statusTag } from "./task-helpers.js";
import { renderTaskCall, renderTaskResult } from "./task-renderers.js";

export type { Task, TaskChangeCallback, TaskDetails } from "./task-helpers.js";

export const CONFIRM_STOP_TAG = "<CONFIRM-TO-STOP/>";

export interface TaskToolHandle {
	getTaskState: () => { tasks: Task[]; pendingCount: number; actionableCount: number; inProgressCount: number; readyTasks: Task[] };
	setOnTaskChange: (cb: TaskChangeCallback) => void;
}

const TaskParams = Type.Object({
	action: StringEnum(["list", "add", "start", "done", "expire", "clear", "update_deps"] as const),
	text: Type.Optional(Type.String({ description: "Task description (required for: add)" })),
	id: Type.Optional(Type.Number({ description: "Task ID (required for: start, done, expire, update_deps)" })),
	reason: Type.Optional(Type.String({ description: "Explanation (required for: expire)" })),
	blocks: Type.Optional(Type.Array(Type.Number(), { description: "Task IDs that this task blocks (for: update_deps)" })),
	blockedBy: Type.Optional(Type.Array(Type.Number(), { description: "Task IDs that block this task (for: update_deps)" })),
});

/**
 * Build a compact numbered list of actionable tasks (in_progress + ready pending)
 * for appending at the very end of the system prompt.
 */
function buildActionableTaskList(allTasks: Task[]): string {
	const inProgress = allTasks.filter((t) => t.status === "in_progress");
	const ready = allTasks.filter((t) => t.status === "pending" && isUnblocked(t, allTasks));
	const items = [...inProgress, ...ready];
	if (items.length === 0) return "";
	const lines = items.map((t, i) => {
		const tag = t.status === "in_progress" ? "[in_progress]" : "[ready]";
		return `${i + 1}. ${tag} #${t.id}: ${t.text}`;
	});
	return ["\n\n## Current Actionable Tasks", ...lines].join("\n");
}

export function registerTaskTool(pi: ExtensionAPI): TaskToolHandle {
	let tasks: Task[] = [];
	let nextId = 1;
	let onTaskChange: TaskChangeCallback | undefined;
	const notifyChange = () => {
		try {
			onTaskChange?.([...tasks]);
		} catch (err) {
			console.error(`[oh-my-pi task] Task change callback failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	// ── State persistence (CustomEntry, orthogonal to LLM context) ──────

	const TASK_ENTRY_TYPE = "omp-task-state";

	interface TaskStateEntry { tasks: Task[]; nextId: number }

	function getTaskStateFromEntry(entry: SessionEntry): TaskStateEntry | undefined {
		if (entry.type !== "custom" || entry.customType !== TASK_ENTRY_TYPE) return undefined;
		const state = validateTaskStateEntryData(entry.data);
		if (!state) {
			console.error("[oh-my-pi task] Ignoring invalid persisted task state entry");
		}
		return state;
	}

	const reloadState = async (ctx: ExtensionContext) => {
		let loaded: TaskStateEntry | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			const state = getTaskStateFromEntry(entry);
			if (state) loaded = state;
		}
		if (!loaded) return;
		tasks = cloneTasks(loaded.tasks);
		nextId = loaded.nextId;
		notifyChange();
	};

	const persistState = () => {
		pi.appendEntry(TASK_ENTRY_TYPE, { tasks: cloneTasks(tasks), nextId } satisfies TaskStateEntry);
	};

	pi.on("session_start", async (_event, ctx) => reloadState(ctx));
	pi.on("session_tree", async (_event, ctx) => reloadState(ctx));

	// ── System prompt injection ──────────────────────────────────────────────

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, _ctx) => {
		const active = tasks.filter((t) => t.status === "in_progress" || (t.status === "pending" && isUnblocked(t, tasks)));
		if (active.length === 0) return;
		const taskLines = active.map((t) => `  - ${statusTag(t, tasks)} [#${t.id}] ${t.text}`).join("\n");
		const injection = [
			"", "## Active Tasks (managed by task tool)",
			"The following tasks are currently actionable. You MUST complete or expire them before stopping.",
			taskLines, "",
			"Use the `task` tool to manage tasks:",
			"  - `start` (id) — mark a task as in progress",
			"  - `done` (id) — mark a task as completed",
			"  - `expire` (id, reason) — mark a task as stale/no longer relevant and explain why",
			"  - `update_deps` (id, blocks?, blockedBy?) — set task dependencies",
			"If the agent loop ends while actionable tasks remain, it will be automatically restarted.", "",
			"Exception: if you genuinely cannot continue right now (e.g. waiting for user input, blocked on external state),",
			`output the exact tag ${CONFIRM_STOP_TAG} anywhere in your final message to acknowledge and suppress the restart.`,
		].join("\n");

		const actionable = buildActionableTaskList(tasks);
		return { systemPrompt: event.systemPrompt + injection + actionable };
	});

	// ── Tool registration ────────────────────────────────────────────────────

	pi.registerTool({
		name: "task", label: "Task",
		description:
			"Manage the tracked task list. " +
			"Actions: list — show all tasks; add (text) — add a new pending task; " +
			"start (id) — mark task as in progress; done (id) — mark task as completed; " +
			"expire (id, reason) — mark task as stale/no longer relevant and explain why; clear — remove all tasks; " +
			"update_deps (id, blocks?, blockedBy?) — set dependency edges. " +
			"Tasks can have dependencies: a [blocked] task cannot start until its blockers are done/expired. " +
			"The loop will restart automatically if any tasks remain in_progress or ready when you stop.",
		promptSnippet:
			"Manage the tracked task list.",
		parameters: TaskParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const action = params.action;
			const mutating =
				action === "add" || action === "start" || action === "done" ||
				action === "expire" || action === "clear" || action === "update_deps";
			const previousTasks = cloneTasks(tasks);
			const previousNextId = nextId;
			let result;
			switch (action) {
				case "list": result = executeList(tasks, nextId); break;
				case "add": {
					const r = executeAdd(params.text, tasks, nextId);
					if ("nextId" in r) { nextId = r.nextId; result = r.result; } else { result = r; }
					break;
				}
				case "start": result = executeStart(params.id, tasks, nextId); break;
				case "done": result = executeDoneOrExpire("done", params.id, undefined, tasks, nextId); break;
				case "expire": result = executeDoneOrExpire("expire", params.id, params.reason, tasks, nextId); break;
				case "update_deps": result = executeUpdateDeps(params, tasks, nextId); break;
				case "clear": tasks = []; nextId = 1; result = executeClear(); break;
				default: {
					const error = `unknown action: ${String(action)}`;
					return {
						content: [{ type: "text", text: `Error: ${error}` }],
						details: { action: "list", tasks: [...tasks], nextId, error } as TaskDetails,
					};
				}
			}
			if (mutating) {
				try {
					persistState();
				} catch (err) {
					tasks = previousTasks;
					nextId = previousNextId;
					console.error(`[oh-my-pi task] Failed to persist task state: ${err instanceof Error ? err.message : String(err)}`);
					throw err;
				}
				notifyChange();
			}
			return result;
		},
		renderCall: renderTaskCall,
		renderResult: renderTaskResult,
	});

	// ── Return handle ────────────────────────────────────────────────────────

	return {
		getTaskState: () => {
			const readyTasks = tasks.filter((t) => t.status === "pending" && isUnblocked(t, tasks));
			const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
			return {
				tasks: [...tasks],
				pendingCount: tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length,
				actionableCount: inProgressCount + readyTasks.length,
				inProgressCount,
				readyTasks,
			};
		},
		setOnTaskChange: (cb: TaskChangeCallback) => { onTaskChange = cb; },
	};
}
