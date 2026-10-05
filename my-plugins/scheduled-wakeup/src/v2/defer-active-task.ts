import { RegistrationExecutionLock } from "./registration-execution-lock.js";
import { SessionEntryAdapter } from "./session-entry-adapter.js";

export type DeferTime = { kind: "delay"; delayMs: number } | { kind: "at"; runAt: number };
export type DeferResult =
	| { kind: "deferred"; nextRunAt: number }
	| { kind: "missing" | "inactive" | "busy" }
	| { kind: "invalid-time"; message: string };

export function deferActiveTask(sessionState: SessionEntryAdapter, locks: RegistrationExecutionLock, id: string, time: DeferTime, now: () => number): DeferResult {
	const isTask = sessionState.reload().tasks.some((task) => task.definition.id === id);
	const executionLock = locks.tryAcquire(`${isTask ? "task" : "registration"}:${id}`);
	if (executionLock === undefined) return { kind: "busy" };
	try {
		const stateLock = locks.tryAcquire("state");
		if (stateLock === undefined) return { kind: "busy" };
		try {
			const state = sessionState.reload();
			const progress = isTask
				? state.tasks.find((task) => task.definition.id === id)?.progress
				: state.registrations.find((registration) => registration.id === id)?.progress;
			if (progress === undefined) return { kind: "missing" };
			if (progress.status !== "active") return { kind: "inactive" };
			const currentNow = now();
			if (time.kind === "delay" && (!Number.isSafeInteger(time.delayMs) || time.delayMs <= 0)) {
				return { kind: "invalid-time", message: "Duration must be a positive safe integer." };
			}
			const nextRunAt = time.kind === "delay" ? Math.max(currentNow, progress.nextRunAt) + time.delayMs : time.runAt;
			if (!Number.isSafeInteger(nextRunAt) || !Number.isFinite(new Date(nextRunAt).getTime()) || nextRunAt <= Math.max(currentNow, progress.nextRunAt)) {
				return { kind: "invalid-time", message: "Time must be later than now and the current next run, within the supported timestamp range." };
			}
			sessionState.dispatch(isTask
				? { kind: "advance-task", taskId: id, progress: { ...progress, nextRunAt } }
				: { kind: "advance-registration", registrationId: id, progress: { ...progress, nextRunAt } });
			return { kind: "deferred", nextRunAt };
		} finally { stateLock.release(); }
	} finally { executionLock.release(); }
}
