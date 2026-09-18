import { executeTaskRequest } from "./execute.js";
import {
	type HumanTaskCommand,
	parseHumanTaskCommand,
} from "./human-command.js";
import { taskRow } from "./list.js";
import {
	cloneTaskState,
	type TaskOperation,
	type TaskOutcome,
	type TaskState,
} from "./model.js";
import { clearTaskState } from "./state.js";

function finish(
	state: TaskState,
	action: "modify" | "clear",
	message: string,
	error?: string,
	outcomes: TaskOutcome[] = [],
): TaskOperation {
	const rows = state.tasks.map((task) => taskRow(task, state.tasks));
	return {
		state,
		changed: !error,
		result: {
			content: [
				{
					type: "text",
					text: error ? `Error: ${error}; no changes applied` : message,
				},
			],
			details: {
				action,
				tasks: rows.map((row) => row.task),
				rows,
				nextId: state.nextId,
				outcomes,
				partial: false,
				error,
			},
		},
	};
}
export function executeHumanTaskCommand(
	previous: TaskState,
	args: string,
): TaskOperation {
	let command: HumanTaskCommand;
	try {
		command = parseHumanTaskCommand(args);
	} catch (error) {
		return finish(
			cloneTaskState(previous),
			"modify",
			"",
			error instanceof Error ? error.message : String(error),
		);
	}
	if (command.action === "add" || command.action === "list")
		return executeTaskRequest(previous, command);
	if (command.action === "clear")
		return finish(
			clearTaskState(previous),
			"clear",
			"Tasks cleared; task ID allocation preserved",
		);
	let state = cloneTaskState(previous);
	const target = state.tasks.find((task) => task.id === command.id);
	if (!target)
		return finish(state, "modify", "", `Task #${command.id} not found`);
	const messages: string[] = [];
	const outcomes: TaskOutcome[] = [];
	if (command.text !== undefined) {
		target.text = command.text;
		target.updatedAt = Date.now();
		messages.push(`#${target.id} text updated`);
	}
	// All sub-operations are pure candidates; the session commits only the final success.
	const requests = [];
	if (command.blockedBy !== undefined)
		requests.push({
			action: "update_deps",
			id: command.id,
			blockedBy: command.blockedBy,
		});
	if (command.status !== undefined)
		requests.push(
			command.status === "expired"
				? { action: "expire", id: command.id, reason: command.reason }
				: {
						action: command.status === "in_progress" ? "start" : "done",
						id: command.id,
					},
		);
	for (const request of requests) {
		const operation = executeTaskRequest(state, request);
		if (operation.result.details.error)
			return finish(
				cloneTaskState(previous),
				"modify",
				"",
				operation.result.details.error,
			);
		state = operation.state;
		outcomes.push(...operation.result.details.outcomes);
		for (const block of operation.result.content)
			if (block.type === "text") messages.push(block.text);
	}
	return finish(state, "modify", messages.join("\n"), undefined, outcomes);
}
