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
import type { Task, TaskChangeCallback } from "./task-helpers.js";
import { isUnblocked, statusTag } from "./task-helpers.js";
import { renderTaskCall, renderTaskResult } from "./task-renderers.js";

export type { Task, TaskChangeCallback, TaskDetails } from "./task-helpers.js";

export const CONFIRM_STOP_TAG = "<CONFIRM-TO-STOP/>";

export interface TaskToolHandle {
	getTaskState: () => { tasks: Task[]; pendingCount: number; inProgressCount: number; readyTasks: Task[] };
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
	const notifyChange = () => onTaskChange?.([...tasks]);

	// ── State persistence (CustomEntry, orthogonal to LLM context) ──────

	const TASK_ENTRY_TYPE = "omp-task-state";

	interface TaskStateEntry { tasks: Task[]; nextId: number }

	function getTaskStateFromEntry(entry: SessionEntry): TaskStateEntry | undefined {
		if (entry.type !== "custom" || entry.customType !== TASK_ENTRY_TYPE) return undefined;
		const data = entry.data as TaskStateEntry | undefined;
		if (data && Array.isArray(data.tasks) && typeof data.nextId === "number") return data;
		return undefined;
	}

	const reloadState = async (ctx: ExtensionContext) => {
		tasks = [];
		nextId = 1;
		for (const entry of ctx.sessionManager.getEntries()) {
			const state = getTaskStateFromEntry(entry);
			if (state) { tasks = state.tasks; nextId = state.nextId; }
		}
		notifyChange();
	};

	const persistState = () => {
		pi.appendEntry(TASK_ENTRY_TYPE, { tasks: [...tasks], nextId } satisfies TaskStateEntry);
	};

	pi.on("session_start", async (_event, ctx) => reloadState(ctx));
	pi.on("session_tree", async (_event, ctx) => reloadState(ctx));

	// ── System prompt injection ──────────────────────────────────────────────

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, _ctx) => {
		const active = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
		if (active.length === 0) return;
		const taskLines = active.map((t) => `  - ${statusTag(t, tasks)} [#${t.id}] ${t.text}`).join("\n");
		const injection = [
			"", "## Active Tasks (managed by task tool)",
			"The following tasks are still pending or in progress. You MUST complete or expire all of them before stopping.",
			taskLines, "",
			"Use the `task` tool to manage tasks:",
			"  - `start` (id) — mark a task as in progress",
			"  - `done` (id) — mark a task as completed",
			"  - `expire` (id, reason) — mark a task as stale/no longer relevant and explain why",
			"  - `update_deps` (id, blocks?, blockedBy?) — set task dependencies",
			"If the agent loop ends while tasks remain pending/in_progress, it will be automatically restarted.", "",
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
			"The loop will restart automatically if any tasks remain pending/in_progress when you stop.",
		promptSnippet:
			"Manage the tracked task list.",
		parameters: TaskParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const mutating = params.action !== "list";
			let result;
			switch (params.action) {
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
			}
			if (mutating) {
				notifyChange();
				persistState();
			}
			return result;
		},
		renderCall: renderTaskCall,
		renderResult: renderTaskResult,
	});

	// ── Return handle ────────────────────────────────────────────────────────

	return {
		getTaskState: () => ({
			tasks: [...tasks],
			pendingCount: tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length,
			inProgressCount: tasks.filter((t) => t.status === "in_progress").length,
			readyTasks: tasks.filter((t) => t.status === "pending" && isUnblocked(t, tasks)),
		}),
		setOnTaskChange: (cb: TaskChangeCallback) => { onTaskChange = cb; },
	};
}
