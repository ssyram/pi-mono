/**
 * Task Tracker Extension - TODO list with agentic loop enforcement
 *
 * Features:
 * - LLM-managed task list via the `task` tool
 * - Automatically restarts the agentic loop if tasks are still incomplete when the agent tries to stop
 * - Supports expiring stale/irrelevant tasks so they don't block completion
 * - Injects active task list into the system prompt at each agent start
 * - /tasks command for user to view task list in UI
 *
 * Task states:
 *   pending  → in progress / not yet done
 *   done     → completed (marks task as done, no longer blocks)
 *   expired  → stale / no longer relevant (does not block loop restart)
 *
 * Enforcement logic (on agent_end):
 *   - If any tasks are still pending → sendUserMessage with followUp to restart the loop
 *   - Agent then decides: keep working, mark done, or expire stale tasks
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const CONFIRM_STOP_TAG = "<CONFIRM-TO-STOP/>";

// ─── Data model ───────────────────────────────────────────────────────────────

interface Task {
	id: number;
	text: string;
	/** "pending" = not done yet, "done" = completed, "expired" = stale/no longer relevant */
	status: "pending" | "done" | "expired";
	createdAt: number;
	updatedAt: number;
}

interface TaskDetails {
	action: "list" | "add" | "done" | "expire" | "clear";
	tasks: Task[];
	nextId: number;
	error?: string;
}

// ─── Tool parameter schema ─────────────────────────────────────────────────────

const TaskParams = Type.Object({
	action: StringEnum(["list", "add", "done", "expire", "clear"] as const),
	text: Type.Optional(
		Type.String({
			description: "Task description (required for: add)",
		}),
	),
	id: Type.Optional(
		Type.Number({
			description: "Task ID (required for: done, expire)",
		}),
	),
});

// ─── UI component ─────────────────────────────────────────────────────────────

class TaskListComponent {
	private tasks: Task[];
	private theme: Theme;
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(tasks: Task[], theme: Theme, onClose: () => void) {
		this.tasks = tasks;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;

		lines.push("");
		const title = th.fg("accent", " Tasks ");
		const border = th.fg("borderMuted", "─");
		lines.push(truncateToWidth(border.repeat(3) + title + border.repeat(Math.max(0, width - 10)), width));
		lines.push("");

		if (this.tasks.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No tasks yet.")}`, width));
		} else {
			const done = this.tasks.filter((t) => t.status === "done").length;
			const expired = this.tasks.filter((t) => t.status === "expired").length;
			const pending = this.tasks.filter((t) => t.status === "pending").length;
			lines.push(
				truncateToWidth(`  ${th.fg("muted", `${done} done · ${pending} pending · ${expired} expired`)}`, width),
			);
			lines.push("");

			for (const task of this.tasks) {
				const icon =
					task.status === "done"
						? th.fg("success", "✓")
						: task.status === "expired"
							? th.fg("dim", "⊘")
							: th.fg("warning", "○");
				const id = th.fg("accent", `#${task.id}`);
				const text = task.status === "pending" ? th.fg("text", task.text) : th.fg("dim", task.text);
				lines.push(truncateToWidth(`  ${icon} ${id} ${text}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let tasks: Task[] = [];
	let nextId = 1;

	// ── State reconstruction ──────────────────────────────────────────────────

	const reconstructState = (ctx: ExtensionContext) => {
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

	// ── System prompt injection ───────────────────────────────────────────────
	// Adds active task list to the system prompt so the agent always knows what's pending.

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, _ctx) => {
		const pending = tasks.filter((t) => t.status === "pending");
		if (pending.length === 0) return;

		const taskLines = pending.map((t) => `  - [#${t.id}] ${t.text}`).join("\n");
		const injection = [
			"",
			"## Active Tasks (managed by task-tracker)",
			"The following tasks are still pending. You MUST complete or expire all of them before stopping.",
			taskLines,
			"",
			"Use the `task` tool to mark tasks as done (`done`) or stale (`expire`).",
			"If the agent loop ends while tasks remain pending, it will be automatically restarted.",
			"",
			`Exception: if you genuinely cannot continue right now (e.g. waiting for user input, blocked on external state),`,
			`output the exact tag ${CONFIRM_STOP_TAG} anywhere in your final message to acknowledge and suppress the restart.`,
		].join("\n");

		return {
			systemPrompt: event.systemPrompt + injection,
		};
	});

	// ── Loop enforcement ──────────────────────────────────────────────────────
	// When the agent loop ends, check for pending tasks. If any remain,
	// inject a follow-up user message to restart the loop.

	pi.on("agent_end", async (event, ctx) => {
		const pending = tasks.filter((t) => t.status === "pending");
		if (pending.length === 0) return;

		// Check if the agent explicitly acknowledged it cannot continue right now.
		// Any assistant message in this turn containing <CONFIRM-TO-STOP/> suppresses the restart.
		const confirmedStop = event.messages.some((m) => {
			const assistant = m as AssistantMessage;
			if (assistant.role !== "assistant") return false;
			return assistant.content.some((c) => c.type === "text" && c.text.includes(CONFIRM_STOP_TAG));
		});
		if (confirmedStop) return;

		const taskLines = pending.map((t) => `  - [#${t.id}] ${t.text}`).join("\n");
		const message = [
			"⚠️ Task list is not complete. The following tasks are still pending:",
			taskLines,
			"",
			"Please continue working. For each task, either:",
			"  • Complete the work and call `task(done, id)` to mark it done",
			"  • Call `task(expire, id)` if it is no longer relevant or has become stale",
			"",
			`If you genuinely cannot continue right now, output ${CONFIRM_STOP_TAG} to acknowledge and stop.`,
		].join("\n");

		// agent_end fires after the loop has ended (isStreaming = false).
		// Calling pi.sendUserMessage without deliverAs goes through the non-streaming path
		// and directly starts a new agent loop — which is what we want for enforcement.
		// If somehow still streaming (shouldn't happen here), fall back to followUp queuing.
		// NOTE: sendUserMessage is on the ExtensionAPI (pi), not on ctx.
		if (ctx.isIdle()) {
			pi.sendUserMessage(message);
		} else {
			pi.sendUserMessage(message, { deliverAs: "followUp" });
		}
	});

	// ── Tool registration ─────────────────────────────────────────────────────

	pi.registerTool({
		name: "task",
		label: "Task",
		description:
			"Manage the tracked task list. " +
			"Actions: list — show all tasks; " +
			"add (text) — add a new pending task; " +
			"done (id) — mark task as completed; " +
			"expire (id) — mark task as stale/no longer relevant; " +
			"clear — remove all tasks. " +
			"The loop will restart automatically if any tasks remain pending when you stop.",
		parameters: TaskParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const now = Date.now();

			const ok = (text: string, action: TaskDetails["action"]): ReturnType<typeof ok> => ({
				content: [{ type: "text", text }],
				details: { action, tasks: [...tasks], nextId } as TaskDetails,
			});

			const err = (action: TaskDetails["action"], error: string) => ({
				content: [{ type: "text", text: `Error: ${error}` }],
				details: { action, tasks: [...tasks], nextId, error } as TaskDetails,
			});

			switch (params.action) {
				case "list":
					return ok(formatTaskList(tasks), "list");

				case "add": {
					if (!params.text) return err("add", "text is required for add");
					const task: Task = {
						id: nextId++,
						text: params.text,
						status: "pending",
						createdAt: now,
						updatedAt: now,
					};
					tasks.push(task);
					return ok(`Added task #${task.id}: ${task.text}`, "add");
				}

				case "done": {
					if (params.id === undefined) return err("done", "id is required for done");
					const task = tasks.find((t) => t.id === params.id);
					if (!task) return err("done", `task #${params.id} not found`);
					task.status = "done";
					task.updatedAt = now;
					return ok(`Task #${task.id} marked as done ✓`, "done");
				}

				case "expire": {
					if (params.id === undefined) return err("expire", "id is required for expire");
					const task = tasks.find((t) => t.id === params.id);
					if (!task) return err("expire", `task #${params.id} not found`);
					task.status = "expired";
					task.updatedAt = now;
					return ok(`Task #${task.id} marked as expired (no longer relevant)`, "expire");
				}

				case "clear": {
					const count = tasks.length;
					tasks = [];
					nextId = 1;
					return {
						content: [{ type: "text", text: `Cleared ${count} task(s)` }],
						details: { action: "clear", tasks: [], nextId: 1 } as TaskDetails,
					};
				}
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("task ")) + theme.fg("muted", args.action);
			if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
			if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
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

					const display = expanded ? taskList : taskList.slice(0, 5);
					let out =
						theme.fg("muted", `${taskList.length} task(s) · `) +
						theme.fg("warning", `${taskList.filter((t) => t.status === "pending").length} pending`);
					for (const t of display) {
						const icon =
							t.status === "done"
								? theme.fg("success", "✓")
								: t.status === "expired"
									? theme.fg("dim", "⊘")
									: theme.fg("warning", "○");
						const txt = t.status === "pending" ? theme.fg("text", t.text) : theme.fg("dim", t.text);
						out += `\n${icon} ${theme.fg("accent", `#${t.id}`)} ${txt}`;
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

				case "done":
				case "expire":
				case "clear": {
					const t = result.content[0];
					const msg = t?.type === "text" ? t.text : "";
					return new Text(theme.fg("success", "✓ ") + theme.fg("muted", msg), 0, 0);
				}
			}
		},
	});

	// ── /tasks command ────────────────────────────────────────────────────────

	pi.registerCommand("tasks", {
		description: "Show the current task list",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/tasks requires interactive mode", "error");
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new TaskListComponent(tasks, theme, () => done());
			});
		},
	});
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTaskList(tasks: Task[]): string {
	if (tasks.length === 0) return "No tasks";
	return tasks
		.map((t) => {
			const status = t.status === "done" ? "[done]" : t.status === "expired" ? "[expired]" : "[ ]";
			return `${status} #${t.id}: ${t.text}`;
		})
		.join("\n");
}
