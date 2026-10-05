import type { SharedDefinitionStore } from "./definition-store.js";
import type { ExecutionProgress, TaskSchedule } from "./model.js";
import { resumeProgress } from "./resume-progress.js";
import type { SessionEntryAdapter } from "./session-entry-adapter.js";

export function suspendSessionSchedules(sessionState: SessionEntryAdapter, now: number): void {
	const state = sessionState.snapshot();
	let changed = false;
	const suspend = (progress: ExecutionProgress): ExecutionProgress => {
		if (progress.status !== "active" || progress.suspendedAt !== undefined) return progress;
		changed = true;
		return { ...progress, suspendedAt: now };
	};
	const tasks = state.tasks.map((task) => ({ ...task, progress: suspend(task.progress) }));
	const registrations = state.registrations.map((registration) => ({ ...registration, progress: suspend(registration.progress) }));
	if (changed) sessionState.dispatch({ kind: "replace-state", state: { version: 1, tasks, registrations } });
}

export function resumeSessionSchedules(sessionState: SessionEntryAdapter, definitions: SharedDefinitionStore, now: number): void {
	const state = sessionState.snapshot();
	let changed = false;
	const resume = (progress: ExecutionProgress, schedule: TaskSchedule): ExecutionProgress => {
		const next = resumeProgress(progress, schedule, now);
		if (next !== progress) changed = true;
		return next;
	};
	const tasks = state.tasks.map((task) => ({ ...task, progress: resume(task.progress, task.definition.schedule) }));
	const registrations = state.registrations.map((registration) => {
		const definition = definitions.get(registration.reference.scope, registration.reference.definitionId);
		return definition === undefined ? registration : { ...registration, progress: resume(registration.progress, definition.schedule) };
	});
	if (changed) sessionState.dispatch({ kind: "replace-state", state: { version: 1, tasks, registrations } });
}
