/**
 * task tool — LLM-managed task list with agentic loop enforcement.
 *
 * Features:
 * - Dependency graph (blocks / blockedBy)
 * - in_progress status
 * - File persistence (.pi/oh-my-pi-tasks.json)
 *
 * Exports a `getTaskState()` function for other components to read.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ─── Constants ───────────────────────────────────────────────────────────────

export const CONFIRM_STOP_TAG = "<CONFIRM-TO-STOP/>";

const TASKS_FILE = ".pi/oh-my-pi-tasks.json";

// ─── Data model ──────────────────────────────────────────────────────────────

export interface Task {
	id: number;
	text: string;
	/** "pending" = not started, "in_progress" = actively working, "done" = completed, "expired" = stale */
	status: "pending" | "in_progress" | "done" | "expired";
	/** Task IDs that this task blocks (downstream dependents) */
	blocks: number[];
	/** Task IDs that block this task (upstream dependencies) */
	blockedBy: number[];
	createdAt: number;
	updatedAt: number;
}

export interface TaskDetails {
	action: "list" | "add" | "start" | "done" | "expire" | "clear" | "update_deps";
	tasks: Task[];
	nextId: number;
	error?: string;
}

// ─── Tool parameter schema ──────────────────────────────────────────────────

const TaskParams = Type.Object({
	action: StringEnum(["list", "add", "start", "done", "expire", "clear", "update_deps"] as const),
	text: Type.Optional(
		Type.String({
			description: "Task description (required for: add)",
		}),
	),
	id: Type.Optional(
		Type.Number({
			description: "Task ID (required for: start, done, expire, update_deps)",
		}),
	),
	blocks: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task IDs that this task blocks (for: update_deps)",
		}),
	),
	blockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task IDs that block this task (for: update_deps)",
		}),
	),
});

// ─── Persistence ────────────────────────────────────────────────────────────

interface PersistedData {
	tasks: Task[];
	nextId: number;
}

async function saveTasks(cwd: string, tasks: Task[], nextId: number): Promise<void> {
	const dir = join(cwd, ".pi");
	await mkdir(dir, { recursive: true });
	const filePath = join(cwd, TASKS_FILE);
	const tempPath = `${filePath}.tmp.${Date.now()}`;
	await writeFile(tempPath, JSON.stringify({ tasks, nextId }, null, 2));
	await rename(tempPath, filePath);
}

async function loadTasks(cwd: string): Promise<PersistedData | null> {
	try {
		const data = await readFile(join(cwd, TASKS_FILE), "utf-8");
		return JSON.parse(data) as PersistedData;
	} catch {
		return null;
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a task is unblocked: all blockedBy tasks are done or expired */
function isUnblocked(task: Task, allTasks: Task[]): boolean {
	if (task.blockedBy.length === 0) return true;
	return task.blockedBy.every((depId) => {
		const dep = allTasks.find((t) => t.id === depId);
		// If the dependency doesn't exist (deleted/cleared), treat as unblocked
		return !dep || dep.status === "done" || dep.status === "expired";
	});
}

/** Get the display tag for a task based on status and dependency state */
function statusTag(task: Task, allTasks: Task[]): string {
	if (task.status === "done") return "[done]";
	if (task.status === "expired") return "[expired]";
	if (task.status === "in_progress") return "[in_progress]";
	// pending — check blocked state
	if (!isUnblocked(task, allTasks)) return "[blocked]";
	return "[ready]";
}

function formatTaskList(tasks: Task[]): string {
	if (tasks.length === 0) return "No tasks";

	// Group by status category
	const inProgress = tasks.filter((t) => t.status === "in_progress");
	const ready = tasks.filter((t) => t.status === "pending" && isUnblocked(t, tasks));
	const blocked = tasks.filter((t) => t.status === "pending" && !isUnblocked(t, tasks));
	const done = tasks.filter((t) => t.status === "done");
	const expired = tasks.filter((t) => t.status === "expired");

	const lines: string[] = [];

	const renderGroup = (label: string, group: Task[]) => {
		if (group.length === 0) return;
		lines.push(`\n${label}:`);
		for (const t of group) {
			const tag = statusTag(t, tasks);
			let line = `${tag} #${t.id}: ${t.text}`;
			if (t.blockedBy.length > 0) {
				const activeBlockers = t.blockedBy.filter((id) => {
					const dep = tasks.find((d) => d.id === id);
					return dep && dep.status !== "done" && dep.status !== "expired";
				});
				if (activeBlockers.length > 0) {
					line += ` (blocked by: ${activeBlockers.map((id) => `#${id}`).join(", ")})`;
				}
			}
			if (t.blocks.length > 0) {
				line += ` (blocks: ${t.blocks.map((id) => `#${id}`).join(", ")})`;
			}
			lines.push(line);
		}
	};

	renderGroup("In Progress", inProgress);
	renderGroup("Ready", ready);
	renderGroup("Blocked", blocked);
	renderGroup("Done", done);
	renderGroup("Expired", expired);

	return lines.join("\n").trim();
}

/** After marking a task done/expired, report newly unblocked tasks */
function findNewlyUnblocked(completedId: number, tasks: Task[]): Task[] {
	return tasks.filter((t) => {
		if (t.status !== "pending") return false;
		if (!t.blockedBy.includes(completedId)) return false;
		return isUnblocked(t, tasks);
	});
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerTaskTool(
	pi: ExtensionAPI,
): () => { tasks: Task[]; pendingCount: number; inProgressCount: number; readyTasks: Task[] } {
	let tasks: Task[] = [];
	let nextId = 1;

	// ── State reconstruction ─────────────────────────────────────────────────

	const reconstructState = async (ctx: ExtensionContext) => {
		// Try file persistence first
		const persisted = await loadTasks(ctx.cwd);
		if (persisted) {
			tasks = persisted.tasks;
			nextId = persisted.nextId;
			return;
		}

		// Fall back to message history reconstruction
		tasks = [];
		nextId = 1;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "task") continue;

			const details = msg.details as TaskDetails | undefined;
			if (details) {
				tasks = details.tasks;
				nextId = details.nextId;
			}
		}
	};

	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_switch", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_fork", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	// ── System prompt injection ──────────────────────────────────────────────

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, _ctx) => {
		const active = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
		if (active.length === 0) return;

		const taskLines = active
			.map((t) => {
				const tag = statusTag(t, tasks);
				return `  - ${tag} [#${t.id}] ${t.text}`;
			})
			.join("\n");
		const injection = [
			"",
			"## Active Tasks (managed by task tool)",
			"The following tasks are still pending or in progress. You MUST complete or expire all of them before stopping.",
			taskLines,
			"",
			"Use the `task` tool to manage tasks:",
			"  - `start` (id) — mark a task as in progress",
			"  - `done` (id) — mark a task as completed",
			"  - `expire` (id) — mark a task as stale/no longer relevant",
			"  - `update_deps` (id, blocks?, blockedBy?) — set task dependencies",
			"If the agent loop ends while tasks remain pending/in_progress, it will be automatically restarted.",
			"",
			`Exception: if you genuinely cannot continue right now (e.g. waiting for user input, blocked on external state),`,
			`output the exact tag ${CONFIRM_STOP_TAG} anywhere in your final message to acknowledge and suppress the restart.`,
		].join("\n");

		return {
			systemPrompt: event.systemPrompt + injection,
		};
	});

	// NOTE: Loop enforcement is handled by boulder.ts hook (not here) to avoid
	// duplicate restart messages. task.ts only provides data + system prompt injection.

	// ── Tool registration ────────────────────────────────────────────────────

	pi.registerTool({
		name: "task",
		label: "Task",
		description:
			"Manage the tracked task list. " +
			"Actions: list — show all tasks; " +
			"add (text) — add a new pending task; " +
			"start (id) — mark task as in progress; " +
			"done (id) — mark task as completed; " +
			"expire (id) — mark task as stale/no longer relevant; " +
			"clear — remove all tasks; " +
			"update_deps (id, blocks?, blockedBy?) — set dependency edges. " +
			"Tasks can have dependencies: a [blocked] task cannot start until its blockers are done/expired. " +
			"The loop will restart automatically if any tasks remain pending/in_progress when you stop.",
		parameters: TaskParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const now = Date.now();
			const cwd = ctx.cwd;

			const ok = (text: string, action: TaskDetails["action"]) => ({
				content: [{ type: "text" as const, text }],
				details: { action, tasks: [...tasks], nextId } as TaskDetails,
			});

			const err = (action: TaskDetails["action"], error: string) => ({
				content: [{ type: "text" as const, text: `Error: ${error}` }],
				details: { action, tasks: [...tasks], nextId, error } as TaskDetails,
			});

			const save = () => saveTasks(cwd, tasks, nextId);

			switch (params.action) {
				case "list":
					return ok(formatTaskList(tasks), "list");

				case "add": {
					if (!params.text) return err("add", "text is required for add");
					const task: Task = {
						id: nextId++,
						text: params.text,
						status: "pending",
						blocks: [],
						blockedBy: [],
						createdAt: now,
						updatedAt: now,
					};
					tasks.push(task);
					await save();
					return ok(`Added task #${task.id}: ${task.text}`, "add");
				}

				case "start": {
					if (params.id === undefined) return err("start", "id is required for start");
					const task = tasks.find((t) => t.id === params.id);
					if (!task) return err("start", `task #${params.id} not found`);
					if (!isUnblocked(task, tasks)) {
						const activeBlockers = task.blockedBy.filter((id) => {
							const dep = tasks.find((d) => d.id === id);
							return dep && dep.status !== "done" && dep.status !== "expired";
						});
						return err("start", `task #${params.id} is blocked by: ${activeBlockers.map((id) => `#${id}`).join(", ")}`);
					}
					task.status = "in_progress";
					task.updatedAt = now;
					await save();
					return ok(`Task #${task.id} started (in progress)`, "start");
				}

				case "done": {
					if (params.id === undefined) return err("done", "id is required for done");
					const task = tasks.find((t) => t.id === params.id);
					if (!task) return err("done", `task #${params.id} not found`);
					task.status = "done";
					task.updatedAt = now;
					await save();

					// Check for newly unblocked tasks
					const unblocked = findNewlyUnblocked(task.id, tasks);
					let msg = `Task #${task.id} marked as done`;
					if (unblocked.length > 0) {
						msg += `\nNewly unblocked: ${unblocked.map((t) => `#${t.id} (${t.text})`).join(", ")}`;
					}
					return ok(msg, "done");
				}

				case "expire": {
					if (params.id === undefined) return err("expire", "id is required for expire");
					const task = tasks.find((t) => t.id === params.id);
					if (!task) return err("expire", `task #${params.id} not found`);
					task.status = "expired";
					task.updatedAt = now;
					await save();

					// Check for newly unblocked tasks
					const unblocked = findNewlyUnblocked(task.id, tasks);
					let msg = `Task #${task.id} marked as expired (no longer relevant)`;
					if (unblocked.length > 0) {
						msg += `\nNewly unblocked: ${unblocked.map((t) => `#${t.id} (${t.text})`).join(", ")}`;
					}
					return ok(msg, "expire");
				}

				case "update_deps": {
					if (params.id === undefined) return err("update_deps", "id is required for update_deps");
					const task = tasks.find((t) => t.id === params.id);
					if (!task) return err("update_deps", `task #${params.id} not found`);

					// Validate referenced task IDs exist
					const allIds = new Set(tasks.map((t) => t.id));
					const newBlocks = params.blocks ?? task.blocks;
					const newBlockedBy = params.blockedBy ?? task.blockedBy;

					for (const id of newBlocks) {
						if (!allIds.has(id)) return err("update_deps", `blocks references non-existent task #${id}`);
						if (id === task.id) return err("update_deps", "a task cannot block itself");
					}
					for (const id of newBlockedBy) {
						if (!allIds.has(id)) return err("update_deps", `blockedBy references non-existent task #${id}`);
						if (id === task.id) return err("update_deps", "a task cannot be blocked by itself");
					}

					// Update this task's edges
					const oldBlocks = task.blocks;
					const oldBlockedBy = task.blockedBy;
					task.blocks = newBlocks;
					task.blockedBy = newBlockedBy;
					task.updatedAt = now;

					// Sync the reverse edges on referenced tasks
					// Remove old reverse edges
					for (const id of oldBlocks) {
						const other = tasks.find((t) => t.id === id);
						if (other) {
							other.blockedBy = other.blockedBy.filter((bid) => bid !== task.id);
							other.updatedAt = now;
						}
					}
					for (const id of oldBlockedBy) {
						const other = tasks.find((t) => t.id === id);
						if (other) {
							other.blocks = other.blocks.filter((bid) => bid !== task.id);
							other.updatedAt = now;
						}
					}
					// Add new reverse edges
					for (const id of newBlocks) {
						const other = tasks.find((t) => t.id === id);
						if (other && !other.blockedBy.includes(task.id)) {
							other.blockedBy.push(task.id);
							other.updatedAt = now;
						}
					}
					for (const id of newBlockedBy) {
						const other = tasks.find((t) => t.id === id);
						if (other && !other.blocks.includes(task.id)) {
							other.blocks.push(task.id);
							other.updatedAt = now;
						}
					}

					await save();
					return ok(
						`Task #${task.id} deps updated — blocks: [${task.blocks.join(", ")}], blockedBy: [${task.blockedBy.join(", ")}]`,
						"update_deps",
					);
				}

				case "clear": {
					const count = tasks.length;
					tasks = [];
					nextId = 1;
					await save();
					return {
						content: [{ type: "text" as const, text: `Cleared ${count} task(s)` }],
						details: { action: "clear" as const, tasks: [], nextId: 1 } as TaskDetails,
					};
				}
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("task ")) + theme.fg("muted", args.action);
			if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
			if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
			if (args.blocks) text += ` ${theme.fg("dim", `blocks=[${args.blocks.join(",")}]`)}`;
			if (args.blockedBy) text += ` ${theme.fg("dim", `blockedBy=[${args.blockedBy.join(",")}]`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as TaskDetails | undefined;
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}
			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			const taskList = details.tasks;

			switch (details.action) {
				case "list": {
					if (taskList.length === 0) return new Text(theme.fg("dim", "No tasks"), 0, 0);

					const inProgressCount = taskList.filter((t) => t.status === "in_progress").length;
					const pendingCount = taskList.filter((t) => t.status === "pending").length;
					const display = expanded ? taskList : taskList.slice(0, 5);
					let out =
						theme.fg("muted", `${taskList.length} task(s) `) +
						theme.fg("warning", `${pendingCount} pending`) +
						(inProgressCount > 0 ? theme.fg("accent", ` ${inProgressCount} in progress`) : "");
					for (const t of display) {
						const tag = statusTag(t, taskList);
						const icon =
							t.status === "done"
								? theme.fg("success", "v")
								: t.status === "expired"
									? theme.fg("dim", "x")
									: t.status === "in_progress"
										? theme.fg("accent", ">")
										: tag === "[blocked]"
											? theme.fg("error", "!")
											: theme.fg("warning", "o");
						const txt =
							t.status === "pending" || t.status === "in_progress"
								? theme.fg("text", t.text)
								: theme.fg("dim", t.text);
						let line = `${icon} ${theme.fg("accent", `#${t.id}`)} ${txt}`;
						if (tag === "[blocked]") line += theme.fg("error", " [blocked]");
						if (tag === "[in_progress]") line += theme.fg("accent", " [in_progress]");
						out += `\n${line}`;
					}
					if (!expanded && taskList.length > 5) {
						out += `\n${theme.fg("dim", `... ${taskList.length - 5} more`)}`;
					}
					return new Text(out, 0, 0);
				}

				case "add": {
					const added = taskList[taskList.length - 1];
					return new Text(
						theme.fg("success", "+ ") +
							theme.fg("accent", `#${added?.id}`) +
							" " +
							theme.fg("muted", added?.text ?? ""),
						0,
						0,
					);
				}

				case "start": {
					const t = result.content[0];
					const msg = t?.type === "text" ? t.text : "";
					return new Text(theme.fg("accent", "> ") + theme.fg("muted", msg), 0, 0);
				}

				case "done":
				case "expire":
				case "clear":
				case "update_deps": {
					const t = result.content[0];
					const msg = t?.type === "text" ? t.text : "";
					return new Text(theme.fg("success", "v ") + theme.fg("muted", msg), 0, 0);
				}
			}
		},
	});

	// ── Return state accessor ────────────────────────────────────────────────

	return () => {
		const readyTasks = tasks.filter(
			(t) => t.status === "pending" && isUnblocked(t, tasks),
		);
		return {
			tasks: [...tasks],
			pendingCount: tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length,
			inProgressCount: tasks.filter((t) => t.status === "in_progress").length,
			readyTasks,
		};
	};
}
