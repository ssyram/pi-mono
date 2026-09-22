import {
	executeDoneOrExpire,
	executeStart,
	executeUpdateDeps,
} from "../task-actions.js";
import { createTaskBatch, terminalEdgeNotice } from "./batch.js";
import { formatTaskRows, selectTaskRows, taskRow } from "./list.js";
import {
	cloneTaskState,
	type TaskOperation,
	type TaskOutcome,
	type TaskRequest,
	type TaskRow,
	type TaskState,
} from "./model.js";
import { parseTaskRequest } from "./schema.js";
import { executeStartNext } from "./start-next.js";

function finish(
	state: TaskState,
	action: TaskRequest["action"],
	outcomes: TaskOutcome[],
	changed: boolean,
	error?: string,
	rows?: TaskRow[],
): TaskOperation {
	const selected =
		rows ?? state.tasks.map((task) => taskRow(task, state.tasks));
	const partial = outcomes.some(({ kind }) => kind.includes("skipped"));
	const text = error
		? `Error: ${error}`
		: action === "list"
			? formatTaskRows(selected)
			: `${partial ? (changed ? "Partially applied:\n" : "Nothing applied:\n") : ""}${outcomes.map((outcome) => outcome.message).join("\n") || "Task updated"}`;
	return {
		state,
		changed,
		result: {
			content: [{ type: "text", text }],
			details: {
				action,
				tasks: selected.map((row) => row.task),
				rows: selected,
				nextId: state.nextId,
				outcomes,
				partial,
				error,
			},
		},
	};
}
export function executeTaskRequest(
	previous: TaskState,
	input: unknown,
): TaskOperation {
	let request: TaskRequest;
	try {
		request = parseTaskRequest(input);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return finish(cloneTaskState(previous), "list", [], false, message);
	}
	const state = cloneTaskState(previous);
	if (request.action === "list")
		return finish(
			state,
			"list",
			[],
			false,
			undefined,
			selectTaskRows(state.tasks, request.type, request.limit),
		);
	if (request.action === "add") {
		const batch = "tasks" in request;
		const outcomes = createTaskBatch(
			state,
			"tasks" in request ? request.tasks : [request],
		);
		const failure = outcomes.find((outcome) =>
			outcome.kind.includes("skipped"),
		);
		if (!batch && failure) {
			const reason =
				failure.kind === "start_skipped"
					? "creation-time start requires satisfied prerequisites"
					: failure.kind === "edge_skipped"
						? "invalid creation dependencies"
						: failure.message;
			return finish(
				cloneTaskState(previous),
				"add",
				[],
				false,
				`add rejected; no task created: ${reason}`,
			);
		}
		return finish(state, "add", outcomes, state.nextId !== previous.nextId);
	}
	if (request.action === "start") {
		const result = executeStart(request.id, state.tasks, state.nextId);
		return finish(
			state,
			"start",
			result.details.error
				? []
				: [
						{
							kind: "started",
							id: request.id,
							message: `#${request.id} started`,
						},
					],
			!result.details.error,
			result.details.error,
		);
	}
	if (request.action === "done" || request.action === "expire") {
		let closedOrder = 0;
		for (const task of state.tasks)
			closedOrder = Math.max(closedOrder, task.closedOrder ?? 0);
		if (closedOrder >= Number.MAX_SAFE_INTEGER)
			return finish(
				state,
				request.action,
				[],
				false,
				"task closure order exhausted",
			);
		const result = executeDoneOrExpire(
			request.action,
			request.id,
			request.action === "expire" ? request.reason : undefined,
			state.tasks,
			state.nextId,
		);
		if (result.details.error)
			return finish(state, request.action, [], false, result.details.error);
		const task = state.tasks.find((candidate) => candidate.id === request.id);
		if (!task) throw new Error("Closed task missing from candidate state");
		task.closedOrder = closedOrder + 1;
		const outcomes =
			request.action === "done"
				? executeStartNext(request.startNext, state.tasks, state.nextId)
				: [];
		const operation = finish(state, request.action, outcomes, true);
		const handoff = outcomes.map((outcome) => outcome.message).join("\n");
		operation.result.content = [
			{
				type: "text",
				text: handoff
					? `${operation.result.details.partial ? "Partially applied:\n" : ""}#${request.id} ${task.status}\n${handoff}`
					: `#${request.id} ${task.status}`,
			},
		];
		return operation;
	}
	const result = executeUpdateDeps(
		{
			...request,
			blocks: request.blocks && [...request.blocks],
			blockedBy: request.blockedBy && [...request.blockedBy],
		},
		state.tasks,
		state.nextId,
	);
	if (result.details.error)
		return finish(state, request.action, [], false, result.details.error);
	const outcomes: TaskOutcome[] = [];
	for (const task of state.tasks) {
		const before = previous.tasks.find((candidate) => candidate.id === task.id);
		for (const prerequisite of task.blockedBy) {
			if (!before?.blockedBy.includes(prerequisite))
				outcomes.push({
					kind: "edge_added",
					id: task.id,
					message: terminalEdgeNotice(task.id, prerequisite, state),
				});
		}
		const dependenciesChanged =
			before &&
			(before.blockedBy.length !== task.blockedBy.length ||
				task.blockedBy.some((id) => !before.blockedBy.includes(id)));
		if (
			task.status === "in_progress" &&
			taskRow(task, state.tasks).blockers.length &&
			(task.id === request.id || dependenciesChanged)
		) {
			task.status = "pending";
			outcomes.push({
				kind: "blocked",
				id: task.id,
				message: `#${task.id} moved from in_progress to blocked; explicit start required after unblocking`,
			});
		}
	}
	return finish(state, request.action, outcomes, true);
}
