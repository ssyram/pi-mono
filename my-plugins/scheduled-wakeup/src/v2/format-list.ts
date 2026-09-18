import { formatDuration } from "../format-duration.js";
import type { ActiveTask, ExecutionProgress, SharedDefinition, TaskSchedule } from "./model.js";

export function describeSchedule(schedule: TaskSchedule): string {
	return schedule.kind === "once" ? `once at ${new Date(schedule.runAt).toISOString()}` : `every ${formatDuration(schedule.intervalMs)}`;
}

export function formatActiveTasks(active: readonly ActiveTask[], now: number = Date.now()): string {
	if (active.length === 0) return "No active scheduled wakeups.";
	return active.map((item) => formatActiveTask(item, now)).join("\n");
}

export function formatAvailableDefinitions(definitions: readonly SharedDefinition[]): string {
	if (definitions.length === 0) return "No available shared definitions.";
	return definitions
		.map((definition) => `${definition.id} | ${definition.scope} | ${describeSchedule(definition.schedule)} | ${definition.prompt}`)
		.join("\n");
}

function formatActiveTask(item: ActiveTask, now: number): string {
	if (item.kind === "session") {
		const definition = item.task.definition;
		return formatLine(definition.id, definition.scope, describeSchedule(definition.schedule), definition.prompt, item.task.progress, now);
	}
	const { registration, definition } = item;
	if (definition === undefined) {
		return formatLine(registration.id, registration.reference.scope, "definition unavailable", "-", registration.progress, now);
	}
	return formatLine(
		registration.id,
		registration.reference.scope,
		describeSchedule(definition.schedule),
		`${definition.prompt} (definition available)`,
		registration.progress,
		now,
	);
}

function formatLine(id: string, scope: string, schedule: string, prompt: string, progress: ExecutionProgress, now: number): string {
	const next = progress.status === "active" ? `next in ${formatDuration(Math.max(0, progress.nextRunAt - now))}` : "completed";
	return `${id} | ${scope} | ${schedule} | ${next} | runs ${progress.runCount} | ${prompt}`;
}
