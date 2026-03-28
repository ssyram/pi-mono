/**
 * task tool — LLM-managed task list with agentic loop enforcement.
 *
 * Per-session state via message history reconstruction (no shared file).
 * UI change callback for persistent TUI widget.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { executeAdd, executeClear, executeDoneOrExpire, executeList, executeStart, executeUpdateDeps } from "./task-actions.js";
import type { Task, TaskChangeCallback, TaskDetails } from "./task-helpers.js";
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
	blocks: Type.Optional(Type.Array(Type.Number(), { description: "Task IDs that this task blocks (for: update_deps)" })),
	blockedBy: Type.Optional(Type.Array(Type.Number(), { description: "Task IDs that block this task (for: update_deps)" })),
});

export function registerTaskTool(pi: ExtensionAPI): TaskToolHandle {
	let tasks: Task[] = [];
	let nextId = 1;
	let onTaskChange: TaskChangeCallback | undefined;
	const notifyChange = () => onTaskChange?.([...tasks]);

	// ── State reconstruction (per-session, from message history) ──────────

	const reconstructState = async (ctx: ExtensionContext) => {
		tasks = [];
		nextId = 1;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "task") continue;
			const details = msg.details as TaskDetails | undefined;
			if (details) { tasks = details.tasks; nextId = details.nextId; }
		}
		notifyChange();
	};

	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_switch", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_fork", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

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
			"  - `expire` (id) — mark a task as stale/no longer relevant",
			"  - `update_deps` (id, blocks?, blockedBy?) — set task dependencies",
			"If the agent loop ends while tasks remain pending/in_progress, it will be automatically restarted.", "",
			"Exception: if you genuinely cannot continue right now (e.g. waiting for user input, blocked on external state),",
			`output the exact tag ${CONFIRM_STOP_TAG} anywhere in your final message to acknowledge and suppress the restart.`,
		].join("\n");
		return { systemPrompt: event.systemPrompt + injection };
	});

	// ── Tool registration ────────────────────────────────────────────────────

	pi.registerTool({
		name: "task", label: "Task",
		description:
			"Manage the tracked task list. " +
			"Actions: list — show all tasks; add (text) — add a new pending task; " +
			"start (id) — mark task as in progress; done (id) — mark task as completed; " +
			"expire (id) — mark task as stale/no longer relevant; clear — remove all tasks; " +
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
				case "done": result = executeDoneOrExpire("done", params.id, tasks, nextId); break;
				case "expire": result = executeDoneOrExpire("expire", params.id, tasks, nextId); break;
				case "update_deps": result = executeUpdateDeps(params, tasks, nextId); break;
				case "clear": tasks = []; nextId = 1; result = executeClear(); break;
			}
			if (mutating) notifyChange();
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
