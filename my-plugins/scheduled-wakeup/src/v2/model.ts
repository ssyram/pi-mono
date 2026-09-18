export type SharedScope = "workspace" | "global";
export type Scope = "session" | SharedScope;

export type TaskSchedule =
	| { kind: "once"; runAt: number }
	| { kind: "interval"; intervalMs: number };

export type TaskInput = { prompt: string; schedule: TaskSchedule };

export type TaskDefinition = {
	id: string;
	scope: Scope;
	prompt: string;
	schedule: TaskSchedule;
	createdAt: number;
};

export type SharedDefinition = TaskDefinition & { scope: SharedScope };
export type SessionDefinition = TaskDefinition & { scope: "session" };

export type ExecutionProgress =
	| { status: "active"; nextRunAt: number; runCount: number; lastRunAt?: number }
	| { status: "completed"; runCount: number; lastRunAt: number };

export type SessionTask = { definition: SessionDefinition; progress: ExecutionProgress };
export type DefinitionReference = { scope: SharedScope; definitionId: string };
export type Registration = { id: string; reference: DefinitionReference; progress: ExecutionProgress; registeredAt: number };
export type SharedRegistrationIndex = DefinitionReference & { sessionId: string; registrationId: string; registeredAt: number };

export type SessionLoopState = { version: 1; tasks: SessionTask[]; registrations: Registration[] };
export type ActiveTask =
	| { kind: "session"; task: SessionTask }
	| { kind: "registration"; registration: Registration; definition: SharedDefinition | undefined };
export type ExecutionTarget = { id: string; scope: Scope; prompt: string };
export type ExecutionResult =
	| { kind: "executed"; id: string; runCount: number }
	| { kind: "locked"; id: string }
	| { kind: "missing"; id: string }
	| { kind: "unavailable"; id: string }
	| { kind: "not-due"; id: string }
	| { kind: "failed"; id: string; message: string }
	| { kind: "compromised"; id: string };
export type SharedDeleteResult =
	| { kind: "deleted" }
	| { kind: "missing" }
	| { kind: "registered-by-others" }
	| { kind: "busy" };

export function isSharedScope(scope: Scope): scope is SharedScope {
	return scope === "workspace" || scope === "global";
}

export function assertTaskInput(input: TaskInput): void {
	if (input.prompt.trim().length === 0) throw new Error("Task prompt must not be empty");
	if (input.schedule.kind === "once") {
		if (!isTimestamp(input.schedule.runAt)) throw new Error("One-shot runAt must be a positive safe integer");
		return;
	}
	if (!isPositiveInteger(input.schedule.intervalMs)) throw new Error("Interval must be a positive safe integer");
}

export function initialProgress(schedule: TaskSchedule, now: number): ExecutionProgress {
	if (schedule.kind === "once") return { status: "active", nextRunAt: schedule.runAt, runCount: 0 };
	return { status: "active", nextRunAt: nextIntervalRunAt(now, schedule.intervalMs), runCount: 0 };
}

export function isDue(progress: ExecutionProgress, now: number): boolean {
	return progress.status === "active" && progress.nextRunAt <= now;
}

export function advanceProgress(progress: ExecutionProgress, schedule: TaskSchedule, now: number): ExecutionProgress {
	if (progress.status !== "active") return cloneProgress(progress);
	const runCount = progress.runCount + 1;
	if (schedule.kind === "once") return { status: "completed", runCount, lastRunAt: now };
	return { status: "active", runCount, lastRunAt: now, nextRunAt: nextIntervalRunAt(now, schedule.intervalMs) };
}

export function cloneSchedule(schedule: TaskSchedule): TaskSchedule {
	return schedule.kind === "once" ? { kind: "once", runAt: schedule.runAt } : { kind: "interval", intervalMs: schedule.intervalMs };
}

export function cloneProgress(progress: ExecutionProgress): ExecutionProgress {
	return progress.status === "completed" ? { ...progress } : { ...progress };
}

export function cloneDefinition<T extends TaskDefinition>(definition: T): T {
	return { ...definition, schedule: cloneSchedule(definition.schedule) };
}

export function cloneRegistration(registration: Registration): Registration {
	return { ...registration, reference: { ...registration.reference }, progress: cloneProgress(registration.progress) };
}

export function cloneSessionTask(task: SessionTask): SessionTask {
	return { definition: cloneDefinition(task.definition), progress: cloneProgress(task.progress) };
}

export function cloneSessionState(state: SessionLoopState): SessionLoopState {
	return { version: 1, tasks: state.tasks.map(cloneSessionTask), registrations: state.registrations.map(cloneRegistration) };
}

function nextIntervalRunAt(now: number, intervalMs: number): number {
	const nextRunAt = now + intervalMs;
	if (!isTimestamp(nextRunAt)) throw new Error("Interval next run time exceeds the safe integer range");
	return nextRunAt;
}

function isTimestamp(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function isPositiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}
