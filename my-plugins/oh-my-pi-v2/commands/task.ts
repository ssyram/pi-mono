import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { createTaskCompletionProvider } from "./task-completion.js";
import {
	TASK_INFO_ENTRY_TYPE,
	formatTaskInfo,
	registerTaskInfoEntryRenderer,
	type TaskInfoEntryData,
} from "../tools/task-info-entry.js";
import type { Task } from "../tools/task-types.js";
import {
	TASK_WIDGET_STATE_ENTRY_TYPE,
	createTaskWidgetState,
	type TaskWidgetStateData,
} from "../tools/task-widget-state.js";

export const TASK_HELP_TEXT = [
	"Task commands:",
	"  /task show on   Show the task widget",
	"  /task show off  Hide the task widget",
	"  /task info       Print complete task details",
	"  /task help       Show this help",
].join("\n");

type ParsedTaskCommand =
	| { action: "help" }
	| { action: "info" }
	| { action: "show"; visible: boolean }
	| { action: "invalid"; input: string };

export interface TaskCommandOptions {
	getTasks(context: ExtensionCommandContext): Task[];
	setWidgetVisibility(context: ExtensionCommandContext, visible: boolean): void;
}

interface PromptCompletionUI {
	addAutocompleteProvider(factory: (current: AutocompleteProvider) => AutocompleteProvider): void;
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

export function registerTaskCommand(pi: ExtensionAPI, options: TaskCommandOptions): void {
	registerTaskInfoEntryRenderer(pi);
	pi.registerCommand("task", {
		description: "Show task details or control the task widget",
		handler: async (args, ctx) => {
			const command = parseTaskCommand(args);
			if (command.action === "help") {
				appendOutput(pi, { tone: "info", text: TASK_HELP_TEXT });
				return;
			}
			if (command.action === "info") {
				appendOutput(pi, { tone: "info", text: formatTaskInfo(options.getTasks(ctx)) });
				return;
			}
			if (command.action === "invalid") {
				appendOutput(pi, {
					tone: "warning",
					text: `Unknown or incomplete /task arguments: ${command.input || "(none)"}\n\n${TASK_HELP_TEXT}`,
				});
				return;
			}

			pi.appendEntry<TaskWidgetStateData>(TASK_WIDGET_STATE_ENTRY_TYPE, createTaskWidgetState(command.visible));
			options.setWidgetVisibility(ctx, command.visible);
			appendOutput(pi, {
				tone: "info",
				text: `Task widget ${command.visible ? "shown" : "hidden"}.`,
			});
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		(ctx.ui as typeof ctx.ui & PromptCompletionUI).addAutocompleteProvider(createTaskCompletionProvider);
	});
}
