/**
 * TUI renderers for the task tool — renderCall and renderResult.
 */

import { Text } from "@mariozechner/pi-tui";
import type { Task, TaskDetails } from "./task-helpers.js";
import { statusTag } from "./task-helpers.js";

export function renderTaskCall(
	args: { action: string; text?: string; id?: number; blocks?: number[]; blockedBy?: number[] },
	theme: any,
	_context: any,
) {
	let text = theme.fg("toolTitle", theme.bold("task ")) + theme.fg("muted", args.action);
	if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
	if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
	if (args.blocks) text += ` ${theme.fg("dim", `blocks=[${args.blocks.join(",")}]`)}`;
	if (args.blockedBy) text += ` ${theme.fg("dim", `blockedBy=[${args.blockedBy.join(",")}]`)}`;
	return new Text(text, 0, 0);
}

export function renderTaskResult(
	result: any,
	{ expanded }: { expanded: boolean },
	theme: any,
	_context: any,
) {
	const details = result.details as TaskDetails | undefined;
	if (!details) {
		const t = result.content[0];
		return new Text(t?.type === "text" ? t.text : "", 0, 0);
	}
	if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

	if (details.action === "list") return renderListResult(details.tasks, expanded, theme);
	// Mutating actions: no TUI output (state visible in widget)
	return new Text("", 0, 0);
}

function renderListResult(taskList: Task[], expanded: boolean, theme: any) {
	if (taskList.length === 0) return new Text(theme.fg("dim", "No tasks"), 0, 0);

	const inProg = taskList.filter((t) => t.status === "in_progress").length;
	const pending = taskList.filter((t) => t.status === "pending").length;
	const display = expanded ? taskList : taskList.slice(0, 5);
	let out = theme.fg("muted", `${taskList.length} task(s) `) + theme.fg("warning", `${pending} pending`)
		+ (inProg > 0 ? theme.fg("accent", ` ${inProg} in progress`) : "");

	for (const t of display) {
		const tag = statusTag(t, taskList);
		const icon = t.status === "done" ? theme.fg("success", "✓")
			: t.status === "expired" ? theme.fg("dim", "✗")
			: t.status === "in_progress" ? theme.fg("accent", "➤")
			: tag === "[blocked]" ? theme.fg("muted", "○")
			: theme.fg("warning", "⚡");
		const txt = (t.status === "pending" || t.status === "in_progress")
			? theme.fg("text", t.text) : theme.fg("dim", t.text);
		let line = `${icon} ${theme.fg("accent", `#${t.id}`)} ${txt}`;
		if (tag === "[blocked]") line += theme.fg("error", " [blocked]");
		if (tag === "[in_progress]") line += theme.fg("accent", " [in_progress]");
		out += `\n${line}`;
	}
	if (!expanded && taskList.length > 5) out += `\n${theme.fg("dim", `... ${taskList.length - 5} more`)}`;
	return new Text(out, 0, 0);
}
