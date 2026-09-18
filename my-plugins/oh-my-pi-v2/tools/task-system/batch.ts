import { executeStart, executeUpdateDeps } from "../task-actions.js";
import type { TaskCreation, TaskOutcome, TaskState } from "./model.js";

export function terminalEdgeNotice(
	dependent: number,
	prerequisite: number,
	state: TaskState,
): string {
	const target = state.tasks.find((task) => task.id === prerequisite);
	const terminal = target?.status === "done" || target?.status === "expired";
	return `#${dependent} blockedBy #${prerequisite}: edge added${terminal ? `; prerequisite already ${target.status}, already satisfied; blocking state unchanged` : ""}`;
}
export function createTaskBatch(
	state: TaskState,
	items: readonly TaskCreation[],
): TaskOutcome[] {
	const outcomes: TaskOutcome[] = [];
	const existing = new Set(state.tasks.map((task) => task.id));
	const keys = new Map<string, number>();
	const created: { item: TaskCreation; index: number; id: number }[] = [];
	for (const [index, item] of items.entries()) {
		const text = item.text ?? "";
		let error: string | undefined;
		if (!text.trim()) error = "text is required";
		else if (item.key !== undefined && (!item.key.trim() || keys.has(item.key)))
			error = "blank or duplicate key";
		else if (state.nextId >= Number.MAX_SAFE_INTEGER)
			error = "task ID space exhausted";
		if (error) {
			outcomes.push({
				kind: "skipped_item",
				item: index,
				key: item.key,
				message: `Item ${index + 1} skipped: ${error}`,
			});
			continue;
		}
		const id = state.nextId++;
		const now = Date.now();
		state.tasks.push({
			id,
			text,
			status: "pending",
			blocks: [],
			blockedBy: [],
			createdAt: now,
			updatedAt: now,
		});
		if (item.key !== undefined) keys.set(item.key, id);
		created.push({ item, index, id });
		outcomes.push({
			kind: "created",
			item: index,
			key: item.key,
			id,
			message: `#${id} created${item.key === undefined ? "" : ` (key ${item.key})`}`,
		});
	}
	for (const { item, index, id } of created) {
		for (const reference of item.blockedBy ?? []) {
			const prerequisite =
				typeof reference === "string"
					? keys.get(reference)
					: existing.has(reference)
						? reference
						: undefined;
			const task = state.tasks.find((candidate) => candidate.id === id);
			if (!task) throw new Error("Created task missing from candidate state");
			let error =
				prerequisite === undefined
					? `unknown pre-call ID or batch key: ${reference}`
					: undefined;
			if (!error && prerequisite !== undefined) {
				const result = executeUpdateDeps(
					{ id, blockedBy: [...task.blockedBy, prerequisite] },
					state.tasks,
					state.nextId,
				);
				error = result.details.error;
			}
			outcomes.push({
				kind: error ? "edge_skipped" : "edge_added",
				item: index,
				id,
				message: error
					? `#${id} dependency ${reference} skipped: ${error}`
					: terminalEdgeNotice(id, prerequisite as number, state),
			});
		}
	}
	for (const { item, index, id } of created) {
		if (!item.start) continue;
		const result = executeStart(id, state.tasks, state.nextId);
		outcomes.push({
			kind: result.details.error ? "start_skipped" : "started",
			item: index,
			id,
			message: result.details.error
				? `#${id} created but not started: ${result.details.error}`
				: `#${id} started`,
		});
	}
	return outcomes;
}
