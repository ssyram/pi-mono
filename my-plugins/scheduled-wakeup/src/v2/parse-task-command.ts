import { parseAtTime } from "../parse-at-time.js";
import { parseDuration } from "../parse-duration.js";
import { prepareScriptTask } from "../script-tasks/prepare-task.js";
import type { SharedScope, TaskInput, TaskSchedule } from "./model.js";
import { readScriptOptions } from "./script-task-options.js";

export type TaskCreationCommand = (
	| { kind: "add" }
	| { kind: "define"; scope: SharedScope }
) &
	TaskInput;
export function parseTaskCommand(
	kind: "add" | "define",
	input: string,
	now: number,
	baseCwd?: string,
): TaskCreationCommand | { kind: "error"; message: string } {
	let body = input.trim();
	let scope: SharedScope | undefined;
	if (kind === "define") {
		const token = /^\S+/.exec(body)?.[0];
		scope =
			token === "ws"
				? "workspace"
				: token === "workspace" || token === "global"
					? token
					: undefined;
		if (!scope || !token)
			return {
				kind: "error",
				message:
					"Usage: /loop define <ws|workspace|global> <schedule> <prompt>",
			};
		body = body.slice(token.length).trimStart();
	}
	const extracted = readScriptOptions(body);
	if (!extracted.ok) return { kind: "error", message: extracted.error };
	let inhibit = extracted.inhibit;
	let promptStarted = false;
	let fields: "head" | "clock" | number = "head";
	const tokens = extracted.rest
		.split(/\s+/)
		.filter(Boolean)
		.filter((token) => {
			if (promptStarted) return true;
			if (token === "--no-boulder") {
				inhibit = true;
				return false;
			}
			if (fields === "head")
				fields = token === "once" ? 1 : token === "at" ? "clock" : 0;
			else if (fields === "clock") {
				if (token === "--") promptStarted = true;
			} else if (fields > 0) fields--;
			else promptStarted = true;
			return true;
		});
	let schedule: TaskSchedule | undefined;
	let prompt = "";
	if (tokens[0] === "at") {
		const separator = tokens.indexOf("--");
		if (separator >= 2) {
			const runAt = parseAtTime(
				tokens.slice(1, separator).join(" "),
				new Date(now),
			);
			if (runAt === undefined)
				return {
					kind: "error",
					message: `Invalid or past time "${tokens.slice(1, separator).join(" ")}".`,
				};
			schedule = { kind: "once", runAt };
			prompt = tokens.slice(separator + 1).join(" ");
		}
	} else {
		const once = tokens[0] === "once";
		const duration = parseDuration(tokens[once ? 1 : 0] ?? "");
		if (duration !== undefined)
			schedule = once
				? { kind: "once", runAt: now + duration }
				: { kind: "interval", intervalMs: duration };
		prompt = tokens.slice(once ? 2 : 1).join(" ");
	}
	if (!schedule)
		return {
			kind: "error",
			message:
				"Usage: /loop add <interval> <prompt> | once <delay> <prompt> | at <future time> -- <prompt>",
		};
	const metadata = { schedule, ...(inhibit ? { inhibitBoulder: true } : {}) };
	const location =
		scope === undefined
			? { kind: "add" as const }
			: { kind: "define" as const, scope };
	if (extracted.options === undefined)
		return prompt.length > 0
			? { ...location, ...metadata, prompt }
			: {
					kind: "error",
					message: "Prompt must contain at least one non-empty token.",
				};
	const { scripts, wake, aggregation } = extracted.options;
	const prepared = prepareScriptTask(
		{
			scripts,
			wakeUp:
				wake === "never"
					? { kind: wake }
					: wake === "always"
						? { kind: wake, prompt }
						: { kind: wake, aggregation, prompt },
		},
		baseCwd ?? process.cwd(),
	);
	return prepared.ok
		? { ...location, ...metadata, scriptTask: prepared.task }
		: { kind: "error", message: prepared.error };
}
