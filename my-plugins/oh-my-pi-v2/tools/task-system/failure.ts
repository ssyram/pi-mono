import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { cloneTaskState, type TaskOperation, type TaskState } from "./model.js";

export interface TaskBoundaryErrorDetails {
	action: "error";
	error: string;
	stateUnavailable: true;
}

// No task reader, row formatter or thrown-value stringification in recovery.
export function taskBoundaryFailure(): AgentToolResult<TaskBoundaryErrorDetails> {
	const error =
		"Task callback failed. Task state and persistence outcome are unavailable; inspect state before retrying.";
	return {
		content: [{ type: "text", text: `Error: ${error}` }],
		details: { action: "error", error, stateUnavailable: true },
	};
}

export function taskOperationFailure(
	previous: TaskState,
	error: string,
): TaskOperation {
	const state = cloneTaskState(previous);
	return {
		state,
		changed: false,
		result: {
			content: [{ type: "text", text: `Error: ${error}` }],
			details: {
				action: "error",
				tasks: state.tasks,
				rows: [],
				nextId: state.nextId,
				outcomes: [],
				partial: false,
				error,
			},
		},
	};
}
