import { executeStart } from "../task-actions.js";
import type { TaskOutcome, TaskRecord } from "./model.js";

export function executeStartNext(
	startNext: number | number[] | undefined,
	tasks: TaskRecord[],
	nextId: number,
): TaskOutcome[] {
	const ids =
		startNext === undefined
			? []
			: Array.isArray(startNext)
				? startNext
				: [startNext];
	const outcomes: TaskOutcome[] = [];
	for (const id of ids) {
		const result = executeStart(id, tasks, nextId);
		const error = result.details.error;
		outcomes.push({
			kind: error ? "start_skipped" : "started",
			id,
			message: error ? `#${id} not started: ${error}` : `#${id} started`,
		});
	}
	return outcomes;
}
