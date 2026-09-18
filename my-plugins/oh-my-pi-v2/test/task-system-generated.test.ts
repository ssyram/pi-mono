import assert from "node:assert/strict";
import { it } from "node:test";
import { executeTaskRequest } from "../tools/task-system/execute.js";
import type { TaskState } from "../tools/task-system/model.js";
import { parseTaskState } from "../tools/task-system/state.js";

function assertGraph(state: TaskState): void {
	const ids = new Set(state.tasks.map((task) => task.id));
	assert.equal(ids.size, state.tasks.length);
	for (const task of state.tasks) {
		assert.ok(
			Number.isSafeInteger(task.id) && task.id > 0 && task.id < state.nextId,
		);
		for (const prerequisite of task.blockedBy) {
			assert.ok(
				state.tasks
					.find((candidate) => candidate.id === prerequisite)
					?.blocks.includes(task.id),
			);
		}
		for (const dependent of task.blocks) {
			assert.ok(
				state.tasks
					.find((candidate) => candidate.id === dependent)
					?.blockedBy.includes(task.id),
			);
		}
	}
	const remaining = new Set(ids);
	while (remaining.size) {
		const removable = state.tasks.filter(
			(task) =>
				remaining.has(task.id) &&
				task.blockedBy.every((id) => !remaining.has(id)),
		);
		assert.ok(
			removable.length > 0,
			"independent topological oracle found a cycle",
		);
		for (const task of removable) remaining.delete(task.id);
	}
	assert.ok(parseTaskState(state));
}

it("preserves immutable valid DAGs over 100 deterministic mixed-operation sequences", () => {
	let seed = 731;
	function random(max: number): number {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed % max;
	}
	for (let sequence = 0; sequence < 100; sequence++) {
		let current: TaskState = { tasks: [], nextId: 1 };
		for (let step = 0; step < 40; step++) {
			const before = structuredClone(current);
			const id = random(current.nextId + 1);
			const reference = random(current.nextId + 2);
			const choices = [
				{
					action: "add",
					tasks: [
						{ key: "a", text: "a", blockedBy: ["b", reference], start: true },
						{ key: "b", text: "b", blockedBy: ["a"], start: true },
					],
				},
				{ action: "update_deps", id, blockedBy: [reference] },
				{ action: "update_deps", id, blocks: [reference] },
				{ action: "start", id },
				{ action: "done", id },
				{ action: "expire", id, reason: "superseded" },
				{ action: "list", type: "blocked", limit: 2 },
			];
			const result = executeTaskRequest(
				current,
				choices[random(choices.length)],
			);
			assert.deepEqual(current, before);
			assert.ok(result.state.nextId >= current.nextId);
			if (result.result.details.error) assert.deepEqual(result.state, before);
			assertGraph(result.state);
			current = result.state;
		}
	}
});
