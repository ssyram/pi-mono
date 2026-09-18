import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskAdmission } from "../tools/task-system/admission.js";
import { executeTaskRequest } from "../tools/task-system/execute.js";
import { state, task, text } from "./task-system-fixtures.js";

describe("dormant single task transitions", () => {
	it("moves direct and reverse-edge running dependents to blocked, then ready", () => {
		for (const request of [
			{ action: "update_deps", id: 2, blockedBy: [1] },
			{ action: "update_deps", id: 1, blocks: [2] },
		]) {
			const original = state(task(1), task(2, "in_progress"));
			const changed = executeTaskRequest(original, request);
			assert.equal(changed.state.tasks[1].status, "pending");
			assert.match(text(changed), /moved from in_progress to blocked/);
			assert.equal(original.tasks[1].status, "in_progress");
			assert.equal(
				taskAdmission("read", () => changed.state.tasks)?.block,
				true,
			);
			const completed = executeTaskRequest(changed.state, {
				action: "done",
				id: 1,
			});
			const listed = executeTaskRequest(completed.state, {
				action: "list",
				type: "ready",
			});
			assert.deepEqual(
				listed.result.details.tasks.map((item) => item.id),
				[2],
			);
			assert.equal(
				taskAdmission("read", () => completed.state.tasks)?.block,
				true,
			);
			const started = executeTaskRequest(completed.state, {
				action: "start",
				id: 2,
			});
			assert.equal(
				taskAdmission("read", () => started.state.tasks),
				undefined,
			);
		}
	});
	it("demotes an affected legacy running-but-blocked dependent without changing unrelated tasks", () => {
		const original = state(
			task(1),
			task(2),
			task(3, "in_progress", [1]),
			task(4, "in_progress", [1]),
		);
		const result = executeTaskRequest(original, {
			action: "update_deps",
			id: 2,
			blocks: [3],
		});
		assert.equal(result.state.tasks[2].status, "pending");
		assert.equal(result.state.tasks[3].status, "in_progress");
		assert.deepEqual(result.state.tasks[2].blockedBy, [1, 2]);
	});
	it("rejects single invalid rewiring without partial changes", () => {
		const original = state(task(1), task(2, "pending", [1]));
		for (const request of [
			{ action: "update_deps", id: 1, blockedBy: [2] },
			{ action: "update_deps", id: 2, blockedBy: [1, 999] },
			{ action: "update_deps", id: 1, blocks: [2, 2] },
			{ action: "update_deps", id: 1, blockedBy: [1] },
		]) {
			const result = executeTaskRequest(original, request);
			assert.equal(result.changed, false);
			assert.ok(result.result.details.error);
			assert.deepEqual(result.state, original);
		}
	});
	it("preserves start rejection and done/expire permissiveness", () => {
		let current = state(task(1), task(2, "pending", [1]));
		assert.ok(
			executeTaskRequest(current, { action: "start", id: 2 }).result.details
				.error,
		);
		assert.ok(
			executeTaskRequest(current, { action: "expire", id: 2, reason: " " })
				.result.details.error,
		);
		current = executeTaskRequest(current, { action: "done", id: 2 }).state;
		assert.equal(current.tasks[1].closedOrder, 1);
		current = executeTaskRequest(current, {
			action: "expire",
			id: 2,
			reason: " obsolete ",
		}).state;
		assert.equal(current.tasks[1].closedOrder, 2);
		assert.equal(current.tasks[1].expireReason, "obsolete");
		assert.ok(
			executeTaskRequest(current, { action: "start", id: 2 }).result.details
				.error,
		);
	});
	it("leaves terminal dependencies satisfied and does not update closure order on rewiring", () => {
		const original = state(
			{ ...task(1, "done"), closedOrder: 5 },
			task(2, "in_progress"),
		);
		const result = executeTaskRequest(original, {
			action: "update_deps",
			id: 1,
			blocks: [2],
		});
		assert.equal(result.state.tasks[0].closedOrder, 5);
		assert.equal(result.state.tasks[1].status, "in_progress");
		assert.match(text(result), /already done.*blocking state unchanged/);
	});
	it("keeps request arrays and returned result details separate from authoritative state", () => {
		const request = { action: "update_deps", id: 2, blockedBy: [1] };
		const original = state(task(1), task(2));
		const result = executeTaskRequest(original, request);
		request.blockedBy.push(99);
		result.result.details.tasks[1].blockedBy.push(98);
		assert.deepEqual(result.state.tasks[1].blockedBy, [1]);
		assert.deepEqual(original.tasks[1].blockedBy, []);
	});
});
