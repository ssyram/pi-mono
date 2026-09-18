import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isUnblocked } from "./task-dependencies.js";
import { renderTaskCall } from "./task-renderers.js";
import {
	type TaskBoundaryErrorDetails,
	taskBoundaryFailure,
	taskOperationFailure,
} from "./task-system/failure.js";
import type {
	TaskOperation,
	TaskResultDetails,
	TaskState,
} from "./task-system/model.js";
import {
	createTaskSession,
	type TaskRestoreResult,
	type TaskSession,
} from "./task-system/session.js";
import { TASK_STATE_ENTRY_TYPE } from "./task-system/state.js";
import { createTaskToolDefinition } from "./task-system/tool-definition.js";
import type { Task, TaskChangeCallback } from "./task-types.js";

export { CONFIRM_STOP_TAG } from "../hooks/boulder-stop-protocol.js";
export type { Task, TaskChangeCallback, TaskDetails } from "./task-types.js";

export interface TaskToolState {
	tasks: Task[];
	pendingCount: number;
	actionableCount: number;
	inProgressCount: number;
	readyTasks: Task[];
}

export interface TaskToolHandle {
	getTaskState(context: ExtensionContext): TaskToolState;
	setOnTaskChange(callback: TaskChangeCallback): void;
	runHumanTaskCommand(
		args: string,
		context: ExtensionContext,
	): AgentToolResult<TaskResultDetails | TaskBoundaryErrorDetails>;
}

interface TaskOwner {
	sessionId: string;
	controller: TaskSession;
	ready: boolean;
}

function summarizeTaskState(state: TaskState): TaskToolState {
	const tasks: Task[] = state.tasks.map((task) => ({ ...task }));
	const readyTasks = tasks.filter(
		(task) => task.status === "pending" && isUnblocked(task, tasks),
	);
	const inProgressCount = tasks.filter(
		(task) => task.status === "in_progress",
	).length;
	return {
		tasks,
		pendingCount: tasks.filter(
			(task) => task.status === "pending" || task.status === "in_progress",
		).length,
		actionableCount: inProgressCount + readyTasks.length,
		inProgressCount,
		readyTasks,
	};
}

export function registerTaskTool(pi: ExtensionAPI): TaskToolHandle {
	const states = new WeakMap<ExtensionContext["sessionManager"], TaskOwner>();
	let onTaskChange: TaskChangeCallback | undefined;
	const stateFor = (context: ExtensionContext): TaskOwner => {
		const sessionId = context.sessionManager.getSessionId();
		const existing = states.get(context.sessionManager);
		if (existing && existing.sessionId === sessionId) return existing;
		const created: TaskOwner = {
			sessionId,
			controller: createTaskSession(),
			ready: false,
		};
		states.set(context.sessionManager, created);
		return created;
	};
	// Readiness is cleared BEFORE restoration; only a successful restore marks the owner ready.
	const ensureReady = (
		context: ExtensionContext,
		owner: TaskOwner,
	): TaskRestoreResult => {
		owner.ready = false;
		try {
			const manager = context.sessionManager;
			const restored = owner.controller.restore(
				manager.getBranch(),
				manager.getEntries(),
			);
			if (!restored.ok) return restored;
			owner.ready = true;
			return { ok: true };
		} catch {
			return {
				ok: false,
				error: "Task owner/history unavailable; requested branch not restored.",
			};
		}
	};
	const readyOwner = (
		context: ExtensionContext,
	):
		| { owner: TaskOwner; failure?: undefined }
		| { owner?: undefined; failure: TaskOperation } => {
		const owner = stateFor(context);
		if (owner.ready) return { owner };
		const restored = ensureReady(context, owner);
		if (!restored.ok)
			return {
				failure: taskOperationFailure(
					owner.controller.snapshot(),
					restored.error,
				),
			};
		return { owner };
	};
	const notifyChange = (context: ExtensionContext, state: TaskState): void => {
		try {
			onTaskChange?.(
				state.tasks.map((task) => ({ ...task })),
				context,
			);
		} catch (error) {
			console.error(
				`[oh-my-pi task] Task change callback failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};
	const persist = (snapshot: TaskState): void => {
		pi.appendEntry(TASK_STATE_ENTRY_TYPE, snapshot);
	};
	// Notification happens after the commit; it must never corrupt or undo the committed result.
	const notifyAfterCommit = (
		context: ExtensionContext,
		owner: TaskOwner,
		operation: TaskOperation,
	): void => {
		try {
			notifyChange(context, owner.controller.snapshot());
		} catch {
			const first = operation.result.content[0];
			if (first?.type === "text")
				first.text +=
					"\nTask changes were committed, but task notification failed.";
		}
	};
	const restoreForLifecycle = (context: ExtensionContext): void => {
		try {
			const owner = stateFor(context);
			const restored = ensureReady(context, owner);
			if (!restored.ok) {
				console.error(`[oh-my-pi task] ${restored.error}`);
				return;
			}
			notifyChange(context, owner.controller.snapshot());
		} catch (error) {
			console.error(
				`[oh-my-pi task] Task restore failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	pi.on("session_start", (_event, context) => restoreForLifecycle(context));
	pi.on("session_tree", (_event, context) => restoreForLifecycle(context));
	pi.on("session_shutdown", (_event, context) => {
		states.delete(context.sessionManager);
	});

	pi.registerTool({
		...createTaskToolDefinition((input, context) => {
			const ready = readyOwner(context);
			if (ready.failure) return ready.failure;
			const operation = ready.owner.controller.execute(input, persist);
			if (operation.changed) notifyAfterCommit(context, ready.owner, operation);
			return operation;
		}),
		renderCall: renderTaskCall,
	});

	return {
		// Read-only consumers keep the retained snapshot; they never mutate or restore.
		getTaskState: (context) =>
			summarizeTaskState(stateFor(context).controller.snapshot()),
		setOnTaskChange: (callback) => {
			onTaskChange = callback;
		},
		runHumanTaskCommand: (args, context) => {
			try {
				const ready = readyOwner(context);
				if (ready.failure) return ready.failure.result;
				const owner = ready.owner;
				const operation = owner.controller.executeHuman(args, persist);
				if (operation.changed) {
					try {
						notifyChange(context, owner.controller.snapshot());
					} catch {
						// Committed already; notification is presentation only.
					}
				}
				return operation.result;
			} catch {
				return taskBoundaryFailure();
			}
		},
	};
}
