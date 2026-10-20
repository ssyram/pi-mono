import type { TaskRun } from "./task-spec.js";

export function renderTaskRun(run: TaskRun, expanded: boolean): string {
	const label = `Loop · ${run.wakeUpId} · ${run.successCount}/${run.results.length} OK · ${run.shouldWake ? "wake" : "no wake"}`;
	return expanded ? `${label}\n${run.content}` : label;
}
