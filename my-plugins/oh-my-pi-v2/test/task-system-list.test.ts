import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeTaskRequest } from "../tools/task-system/execute.js";
import { formatTaskRows, selectTaskRows } from "../tools/task-system/list.js";
import type { TaskListType } from "../tools/task-system/model.js";
import { state, task, text } from "./task-system-fixtures.js";

describe("dormant task list views", () => {
	it("shows all open plus combined latest ten closed, without changing authoritative state", () => {
		const ended = Array.from({ length: 16 }, (_, index) => ({
			...task(index + 10, index % 2 ? "expired" : "done"),
			closedOrder: index + 1,
		}));
		const original = state(
			task(1),
			task(2, "pending", [1]),
			task(3, "in_progress"),
			...ended,
		);
		const result = executeTaskRequest(original, { action: "list" });
		assert.equal(result.result.details.tasks.length, 13);
		assert.deepEqual(
			result.result.details.tasks.map((item) => item.id),
			[3, 1, 2, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16],
		);
		assert.equal(result.changed, false);
		assert.deepEqual(result.state, original);
		assert.equal(original.tasks.length, 19);
		assert.equal(text(result), formatTaskRows(result.result.details.rows));
		assert.deepEqual(
			result.result.details.tasks,
			result.result.details.rows.map((row) => row.task),
		);
	});
	it("supports every explicit type and applies limit after filtering", () => {
		const original = state(
			task(1),
			task(2, "pending", [1]),
			task(3, "in_progress"),
			{ ...task(4, "done"), closedOrder: 2 },
			{ ...task(5, "expired"), closedOrder: 1 },
		);
		const expected: Record<TaskListType, number[]> = {
			open: [3, 1, 2],
			closed: [4, 5],
			in_progress: [3],
			ready: [1],
			blocked: [2],
			done: [4],
			expired: [5],
		};
		for (const type of Object.keys(expected) as TaskListType[]) {
			assert.deepEqual(
				selectTaskRows(original.tasks, type).map((row) => row.task.id),
				expected[type],
			);
			assert.deepEqual(
				selectTaskRows(original.tasks, type, 1).map((row) => row.task.id),
				expected[type].slice(0, 1),
			);
			assert.deepEqual(selectTaskRows(original.tasks, type, 0), []);
		}
	});
	it("does not infer readiness from filtered visible tasks", () => {
		const original = state(task(1), task(2, "pending", [1]));
		const result = executeTaskRequest(original, {
			action: "list",
			type: "blocked",
			limit: 1,
		});
		assert.equal(result.result.details.tasks.length, 1);
		assert.equal(result.result.details.rows[0].status, "blocked");
		assert.deepEqual(result.result.details.rows[0].blockers, [1]);
		assert.match(text(result), /\[blocked\] #2/);
	});
	it("orders closures independently of IDs and updatedAt; unknown history follows", () => {
		const original = state(
			{ ...task(1, "done"), closedOrder: 2, updatedAt: 1 },
			{ ...task(8, "expired"), closedOrder: 1, updatedAt: 1000 },
			task(20, "done"),
			task(10, "expired"),
		);
		assert.deepEqual(
			selectTaskRows(original.tasks, "closed").map((row) => row.task.id),
			[1, 8, 20, 10],
		);
	});
	it("rejects limit without type and malformed limits instead of altering overview", () => {
		for (const request of [
			{ action: "list", limit: 1 },
			{ action: "list", type: "open", limit: -1 },
			{ action: "list", type: "open", limit: 1.5 },
			{ action: "list", type: "default" },
		]) {
			const result = executeTaskRequest(state(), request);
			assert.ok(result.result.details.error);
			assert.equal(result.changed, false);
		}
	});
});
