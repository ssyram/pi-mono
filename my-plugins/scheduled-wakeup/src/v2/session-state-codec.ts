import type {
	DefinitionReference,
	ExecutionProgress,
	Registration,
	SessionDefinition,
	SessionLoopState,
	SessionTask,
	SharedScope,
	TaskSchedule,
} from "./model.js";

export function parseSessionLoopState(value: unknown): SessionLoopState | undefined {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.registrations)) return undefined;
	const tasks: SessionTask[] = [];
	for (const entry of value.tasks) {
		const task = parseSessionTask(entry);
		if (task === undefined) return undefined;
		tasks.push(task);
	}
	const registrations: Registration[] = [];
	for (const entry of value.registrations) {
		const registration = parseRegistration(entry);
		if (registration === undefined) return undefined;
		registrations.push(registration);
	}
	if (hasDuplicate(tasks.map((task) => task.definition.id))) return undefined;
	if (hasDuplicate(registrations.map((registration) => registration.id))) return undefined;
	if (hasDuplicate(registrations.map((registration) => `${registration.reference.scope}:${registration.reference.definitionId}`))) return undefined;
	return { version: 1, tasks, registrations };
}

export function parseSharedDefinition(value: unknown): { id: string; scope: SharedScope; prompt: string; schedule: TaskSchedule; createdAt: number } | undefined {
	if (!isRecord(value) || !isSharedScope(value.scope)) return undefined;
	const base = parseDefinitionBase(value);
	return base === undefined ? undefined : { ...base, scope: value.scope };
}

function parseSessionTask(value: unknown): SessionTask | undefined {
	if (!isRecord(value) || !isRecord(value.definition)) return undefined;
	const base = parseDefinitionBase(value.definition);
	if (base === undefined || value.definition.scope !== "session") return undefined;
	const progress = parseProgress(value.progress);
	return progress === undefined ? undefined : { definition: { ...base, scope: "session" }, progress };
}

function parseRegistration(value: unknown): Registration | undefined {
	if (!isRecord(value) || !isText(value.id) || !isTimestamp(value.registeredAt)) return undefined;
	const reference = parseReference(value.reference);
	const progress = parseProgress(value.progress);
	return reference === undefined || progress === undefined ? undefined : { id: value.id, reference, progress, registeredAt: value.registeredAt };
}

function parseReference(value: unknown): DefinitionReference | undefined {
	if (!isRecord(value) || !isSharedScope(value.scope) || !isText(value.definitionId)) return undefined;
	return { scope: value.scope, definitionId: value.definitionId };
}

function parseDefinitionBase(value: Record<string, unknown>): Omit<SessionDefinition, "scope"> | undefined {
	if (!isText(value.id) || !isText(value.prompt) || !isTimestamp(value.createdAt)) return undefined;
	const schedule = parseSchedule(value.schedule);
	return schedule === undefined ? undefined : { id: value.id, prompt: value.prompt, schedule, createdAt: value.createdAt };
}

function parseSchedule(value: unknown): TaskSchedule | undefined {
	if (!isRecord(value) || typeof value.kind !== "string") return undefined;
	if (value.kind === "once" && isTimestamp(value.runAt)) return { kind: "once", runAt: value.runAt };
	if (value.kind === "interval" && isPositiveInteger(value.intervalMs)) return { kind: "interval", intervalMs: value.intervalMs };
	return undefined;
}

function parseProgress(value: unknown): ExecutionProgress | undefined {
	if (!isRecord(value) || !isPositiveIntegerOrZero(value.runCount) || typeof value.status !== "string") return undefined;
	if (value.status === "completed" && isTimestamp(value.lastRunAt)) {
		return { status: "completed", runCount: value.runCount, lastRunAt: value.lastRunAt };
	}
	if (value.status !== "active" || !isTimestamp(value.nextRunAt)) return undefined;
	if (value.lastRunAt !== undefined && !isTimestamp(value.lastRunAt)) return undefined;
	return value.lastRunAt === undefined
		? { status: "active", runCount: value.runCount, nextRunAt: value.nextRunAt }
		: { status: "active", runCount: value.runCount, nextRunAt: value.nextRunAt, lastRunAt: value.lastRunAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isSharedScope(value: unknown): value is SharedScope {
	return value === "workspace" || value === "global";
}

function isTimestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPositiveIntegerOrZero(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasDuplicate(values: readonly string[]): boolean {
	return new Set(values).size !== values.length;
}
