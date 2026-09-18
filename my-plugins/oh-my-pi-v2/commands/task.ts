import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { TaskToolHandle } from "../tools/task.js";
import {
	formatTaskInfo,
	registerTaskInfoEntryRenderer,
	TASK_INFO_ENTRY_TYPE,
	type TaskInfoEntryData,
} from "../tools/task-info-entry.js";
import { createHumanTaskCompletionProvider } from "../tools/task-system/human-completion.js";
import type { Task } from "../tools/task-types.js";
import {
	createTaskWidgetState,
	TASK_WIDGET_STATE_ENTRY_TYPE,
	type TaskWidgetStateData,
} from "../tools/task-widget-state.js";

export const TASK_HELP_TEXT = [
	"Task commands:",
	"  /task add TEXT [--start] [--blocked-by IDS]  Create a task (quote text containing spaces)",
	"  /task modify ID [--text TEXT] [--blocked-by IDS] [--status in_progress|done|expired] [--reason TEXT]",
	"  /task list [--type TYPE] [--limit N]         List tasks (TYPE: open|closed|in_progress|ready|blocked|done|expired)",
	"  /task clear --CONFIRMED                      Remove every task (requires the explicit --CONFIRMED flag; task ID allocation is preserved)",
	"  /task show on|off                            Show or hide the task widget",
	"  /task info                                   Print complete task details",
	"  /task help                                   Show this help",
].join("\n");

type ParsedTaskCommand =
	| { action: "help" }
	| { action: "info" }
	| { action: "show"; visible: boolean }
	| { action: "invalid"; input: string };

export interface TaskCommandOptions {
	getTasks(context: ExtensionContext): Task[];
	setWidgetVisibility(context: ExtensionContext, visible: boolean): void;
	runHumanTaskCommand: TaskToolHandle["runHumanTaskCommand"];
}

interface PromptCompletionUI {
	addAutocompleteProvider(
		factory: (current: AutocompleteProvider) => AutocompleteProvider,
	): void;
}

export function parseTaskCommand(args: string): ParsedTaskCommand {
	const input = args.trim();
	if (input === "") return { action: "help" };
	const tokens = input.toLowerCase().split(/\s+/);
	if (tokens.length === 1 && tokens[0] === "help") return { action: "help" };
	if (tokens.length === 1 && tokens[0] === "info") return { action: "info" };
	if (tokens.length === 2 && tokens[0] === "show" && tokens[1] === "on") {
		return { action: "show", visible: true };
	}
	if (tokens.length === 2 && tokens[0] === "show" && tokens[1] === "off") {
		return { action: "show", visible: false };
	}
	return { action: "invalid", input };
}

function appendOutput(pi: ExtensionAPI, data: TaskInfoEntryData): void {
	pi.appendEntry<TaskInfoEntryData>(TASK_INFO_ENTRY_TYPE, data);
}

const HUMAN_ROOTS = new Set(["add", "modify", "list", "clear"]);

function isHumanTaskCommand(args: string): boolean {
	return HUMAN_ROOTS.has(args.trim().split(/\s+/)[0] ?? "");
}

export function registerTaskCommand(
	pi: ExtensionAPI,
	options: TaskCommandOptions,
): void {
	registerTaskInfoEntryRenderer(pi);
	pi.registerCommand("task", {
		description: "Manage tasks or control the task widget",
		handler: async (args, ctx) => {
			// Human commands receive the ENTIRE original string; quoted text must survive routing.
			if (isHumanTaskCommand(args)) {
				const result = options.runHumanTaskCommand(args, ctx);
				const text = result.content
					.map((block) => (block.type === "text" ? block.text : ""))
					.join("\n");
				try {
					appendOutput(pi, {
						tone: result.details?.error ? "warning" : "info",
						text,
					});
				} catch (error) {
					console.error(
						`[oh-my-pi task] Failed to print task command output: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				return;
			}
			const command = parseTaskCommand(args);
			if (command.action === "help") {
				appendOutput(pi, { tone: "info", text: TASK_HELP_TEXT });
				return;
			}
			if (command.action === "info") {
				appendOutput(pi, {
					tone: "info",
					text: formatTaskInfo(options.getTasks(ctx)),
				});
				return;
			}
			if (command.action === "invalid") {
				appendOutput(pi, {
					tone: "warning",
					text: `Unknown or incomplete /task arguments: ${command.input || "(none)"}\n\n${TASK_HELP_TEXT}`,
				});
				return;
			}

			pi.appendEntry<TaskWidgetStateData>(
				TASK_WIDGET_STATE_ENTRY_TYPE,
				createTaskWidgetState(command.visible),
			);
			options.setWidgetVisibility(ctx, command.visible);
			appendOutput(pi, {
				tone: "info",
				text: `Task widget ${command.visible ? "shown" : "hidden"}.`,
			});
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			(ctx.ui as typeof ctx.ui & PromptCompletionUI).addAutocompleteProvider(
				(current) =>
					createHumanTaskCompletionProvider(current, () =>
						options.getTasks(ctx),
					),
			);
		} catch (error) {
			console.error(
				`[oh-my-pi task] Failed to install task autocomplete: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
}
