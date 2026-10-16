import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { executeBoulderSetCommand } from "../boulder-inhibition/command.js";
import { describeThrown } from "../boulder-inhibition/describe-error.js";
import { formatBoulderInhibition } from "../boulder-inhibition/format-inhibition.js";
import { reportBoulderDiagnostic } from "../boulder-inhibition/report-error.js";
import { createBoulderInhibitionClient } from "../boulder-inhibition/service-client.js";
import type {
	TaskSettingChange,
	TaskSettingKey,
	TaskSettingTargets,
} from "../task-settings.js";
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
	parseTaskSettingCommand,
	type TaskSettingCommand,
} from "./task-setting-command.js";

export const TASK_HELP_TEXT = [
	"Task commands:",
	"  /task add TEXT [--start] [--blocked-by IDS]  Create a task (quote text containing spaces)",
	"  /task modify ID [--text TEXT] [--blocked-by IDS] [--status in_progress|done|expired] [--reason TEXT]",
	"  /task list [--type TYPE] [--limit N]         List tasks (TYPE: open|closed|in_progress|ready|blocked|done|expired)",
	"  /task clear --CONFIRMED                      Remove every task (requires the explicit --CONFIRMED flag; task ID allocation is preserved)",
	"  /task boulder set <type> <true|false|t|f>    Set a Boulder inhibition signal (e.g. /task boulder set loop false)",
	"  /task show on|off [--persistent] [--global]   Show/hide widget (default: session; flags also save local/global)",
	"  /task no-task-no-tool on|off [--persistent] [--global]  Set gate (default: session; flags also save local/global)",
	"  /task info                                   Print complete task details",
	"  /task help                                   Show this help",
].join("\n");

type ParsedTaskCommand =
	| { action: "help" }
	| { action: "info" }
	| TaskSettingCommand
	| { action: "invalid"; input: string };

export interface TaskCommandOptions {
	getTasks(context: ExtensionContext): Task[];
	setWidgetVisibility(
		context: ExtensionContext,
		visible: boolean,
	): void | Promise<void>;
	runHumanTaskCommand: TaskToolHandle["runHumanTaskCommand"];
	updateSetting(
		context: ExtensionContext,
		key: TaskSettingKey,
		value: boolean,
		targets: TaskSettingTargets,
	): Promise<TaskSettingChange>;
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
	const setting = parseTaskSettingCommand(tokens);
	if (setting) return setting;
	if (tokens.length === 1 && tokens[0] === "help") return { action: "help" };
	if (tokens.length === 1 && tokens[0] === "info") return { action: "info" };
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
			try {
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
						reportBoulderDiagnostic(
							`[oh-my-pi task] Failed to print task command output: ${describeThrown(error)}`,
						);
					}
					return;
				}
				if (args.trim().split(/\s+/)[0]?.toLowerCase() === "boulder") {
					const client = createBoulderInhibitionClient(
						pi.events,
						ctx.sessionManager,
					);
					const result = executeBoulderSetCommand(args, client);
					// Route guarantees the first token is "boulder", so parse yields set/invalid/failed only.
					if (
						result.kind !== "set" &&
						result.kind !== "invalid" &&
						result.kind !== "failed"
					) {
						appendOutput(pi, { tone: "warning", text: TASK_HELP_TEXT });
						return;
					}
					const text =
						result.kind === "set"
							? `Boulder signal ${result.signal.type}=${result.signal.value}; ${formatBoulderInhibition(result.snapshot)}`
							: result.kind === "failed"
								? `Boulder set failed: ${result.failure.message}`
								: result.message;
					appendOutput(pi, {
						tone: result.kind === "set" ? "info" : "warning",
						text,
					});
					return;
				}
				const command = parseTaskCommand(args);
				if (command.action === "help") {
					appendOutput(pi, { tone: "info", text: TASK_HELP_TEXT });
					return;
				}
				if (command.action === "no-task-no-tool" || command.action === "show") {
					const key =
						command.action === "show"
							? "omp-task:show"
							: "omp-task:no-task-no-tool";
					const value =
						command.action === "show" ? command.visible : command.enabled;
					const result = await options.updateSetting(
						ctx,
						key,
						value,
						command.targets,
					);
					if (command.action === "show" && result.applied) {
						try {
							await options.setWidgetVisibility(ctx, value);
						} catch (error) {
							appendOutput(pi, {
								tone: "warning",
								text: `${result.message} Widget refresh failed: ${describeThrown(error)}`,
							});
							return;
						}
					}
					appendOutput(pi, {
						tone: result.ok ? "info" : "warning",
						text: result.message,
					});
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
			} catch (error) {
				reportBoulderDiagnostic(
					`[oh-my-pi task] Command failed: ${describeThrown(error)}. State may already have changed.`,
				);
			}
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
			reportBoulderDiagnostic(
				`[oh-my-pi task] Failed to install task autocomplete: ${describeThrown(error)}`,
			);
		}
	});
}
