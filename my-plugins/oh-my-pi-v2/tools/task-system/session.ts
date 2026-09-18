import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { executeTaskRequest } from "./execute.js";
import { taskOperationFailure } from "./failure.js";
import { executeHumanTaskCommand } from "./human-execute.js";
import { cloneTaskState, type TaskOperation, type TaskState } from "./model.js";
import { restoreTaskState } from "./state.js";

export type TaskRestoreResult = { ok: true } | { ok: false; error: string };

export function createTaskSession(
	initial: TaskState = { tasks: [], nextId: 1 },
) {
	let state = cloneTaskState(initial);
	function publish(
		operation: TaskOperation,
		persist: (snapshot: TaskState) => void,
	): TaskOperation {
		if (!operation.changed) return operation;
		// Reserve before I/O; an append can become observable before persistence fails.
		state.nextId = Math.max(state.nextId, operation.state.nextId);
		try {
			const installed = cloneTaskState(operation.state);
			persist(cloneTaskState(installed));
			state = installed;
			return operation;
		} catch {
			return taskOperationFailure(
				state,
				"Task persistence failed. Controller task records are unchanged and allocated IDs remain reserved. Native log/disk outcome is uncertain; no rollback is claimed.",
			);
		}
	}
	function executeHuman(
		args: string,
		persist: (snapshot: TaskState) => void,
	): TaskOperation {
		let operation: TaskOperation;
		try {
			operation = executeHumanTaskCommand(state, args);
		} catch {
			return taskOperationFailure(
				state,
				"Human task operation failed before persistence; no task changes were published.",
			);
		}
		return publish(operation, persist);
	}
	return {
		snapshot: (): TaskState => cloneTaskState(state),
		restore(
			branch: readonly SessionEntry[],
			history: readonly SessionEntry[],
		): TaskRestoreResult {
			try {
				state = restoreTaskState(branch, history, state.nextId);
				return { ok: true };
			} catch {
				return {
					ok: false,
					error:
						"Task restoration failed; previous controller state retained, requested branch not restored.",
				};
			}
		},
		execute(
			input: unknown,
			persist: (snapshot: TaskState) => void,
		): TaskOperation {
			let operation: TaskOperation;
			try {
				operation = executeTaskRequest(state, input);
			} catch {
				return taskOperationFailure(
					state,
					"Task operation failed before persistence; no task changes were published.",
				);
			}
			return publish(operation, persist);
		},
		executeHuman,
		clear(persist: (snapshot: TaskState) => void): TaskOperation {
			// The --CONFIRMED gate lives at the human command surface; this explicit
			// controller method is the programmatic confirmed clear.
			return executeHuman("clear --CONFIRMED", persist);
		},
	};
}
export type TaskSession = ReturnType<typeof createTaskSession>;
