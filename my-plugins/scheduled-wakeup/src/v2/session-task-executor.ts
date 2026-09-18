import {
	advanceProgress,
	isDue,
	type ExecutionResult,
	type ExecutionTarget,
	type SessionTask,
} from "./model.js";
import { RegistrationExecutionLock } from "./registration-execution-lock.js";
import { SessionEntryAdapter } from "./session-entry-adapter.js";
import type { DeliverTask } from "./registration-executor.js";

export class SessionTaskExecutor {
	private readonly sessionState: SessionEntryAdapter;
	private readonly locks: RegistrationExecutionLock;
	private readonly now: () => number;

	constructor(sessionState: SessionEntryAdapter, locks: RegistrationExecutionLock, now: () => number) {
		this.sessionState = sessionState;
		this.locks = locks;
		this.now = now;
	}

	execute(taskId: string, deliver: DeliverTask): ExecutionResult {
		const executionLock = this.locks.tryAcquire(`task:${taskId}`);
		if (executionLock === undefined) return { kind: "locked", id: taskId };
		try {
			const stateLock = this.locks.tryAcquire("state");
			if (stateLock === undefined) return { kind: "locked", id: taskId };
			try {
				this.sessionState.reload();
				const task = this.sessionState.snapshot().tasks.find((candidate) => candidate.definition.id === taskId);
				if (task === undefined) return { kind: "missing", id: taskId };
				if (!isDue(task.progress, this.now())) return { kind: "not-due", id: taskId };
				const delivered = this.deliver(task, deliver);
				if (delivered !== undefined) return delivered;
				if (executionLock.compromised() || stateLock.compromised()) return { kind: "compromised", id: taskId };
				const progress = advanceProgress(task.progress, task.definition.schedule, this.now());
				this.sessionState.dispatch({ kind: "advance-task", taskId, progress });
				if (executionLock.compromised() || stateLock.compromised()) return { kind: "compromised", id: taskId };
				return { kind: "executed", id: taskId, runCount: progress.runCount };
			} catch (error) {
				return { kind: "failed", id: taskId, message: errorMessage(error) };
			} finally {
				stateLock.release();
			}
		} finally {
			executionLock.release();
		}
	}

	private deliver(task: SessionTask, deliver: DeliverTask): ExecutionResult | undefined {
		try {
			const target: ExecutionTarget = { id: task.definition.id, scope: "session", prompt: task.definition.prompt };
			deliver(target);
			return undefined;
		} catch (error) {
			return { kind: "failed", id: task.definition.id, message: errorMessage(error) };
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
