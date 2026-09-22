import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { renderTaskCall } from "../tools/task-renderers.js";
import { executeTaskRequest } from "../tools/task-system/execute.js";
import type { TaskState } from "../tools/task-system/model.js";
import { createTaskSession } from "../tools/task-system/session.js";
import { TaskToolParameters } from "../tools/task-system/tool-definition.js";
import { state, task, text } from "./task-system-fixtures.js";

const plainTheme = {
	fg: (_color: string, value: string) => value,
	bold: (value: string) => value,
} as Theme;

describe("done startNext handoff", () => {
	it("closes before a scalar handoff starts its newly unblocked successor", () => {
		const original = state(task(1, "in_progress"), task(2, "pending", [1]));
		const request = { action: "done" as const, id: 1, startNext: 2 };
		const received = structuredClone(request);
		const result = executeTaskRequest(original, request);

		assert.deepEqual(request, received);
		assert.equal(original.tasks[0].status, "in_progress");
		assert.equal(original.tasks[1].status, "pending");
		assert.equal(result.changed, true);
		assert.equal(result.state.tasks[0].status, "done");
		assert.equal(result.state.tasks[0].closedOrder, 1);
		assert.equal(result.state.tasks[1].status, "in_progress");
		assert.deepEqual(result.result.details.outcomes, [
			{ kind: "started", id: 2, message: "#2 started" },
		]);
		assert.equal(result.result.details.partial, false);
		assert.equal(result.result.details.error, undefined);
		assert.equal(text(result), "#1 done\n#2 started");
	});

	it("continues ordered array handoffs after blocked and missing targets", () => {
		const original = state(
			task(1, "in_progress"),
			task(2, "pending", [1]),
			task(3, "pending", [4]),
			task(4),
		);
		const result = executeTaskRequest(original, {
			action: "done",
			id: 1,
			startNext: [2, 3, 99],
		});

		assert.deepEqual(
			result.result.details.outcomes.map((outcome) => [
				outcome.kind,
				outcome.id,
				outcome.message,
			]),
			[
				["started", 2, "#2 started"],
				["start_skipped", 3, "#3 not started: task #3 is blocked by: #4"],
				["start_skipped", 99, "#99 not started: task #99 not found"],
			],
		);
		assert.equal(result.state.tasks[1].status, "in_progress");
		assert.equal(result.state.tasks[2].status, "pending");
		assert.equal(result.result.details.partial, true);
		assert.equal(result.result.details.error, undefined);
		assert.equal(
			text(result),
			"Partially applied:\n#1 done\n#2 started\n#3 not started: task #3 is blocked by: #4\n#99 not started: task #99 not found",
		);
	});

	it("retains empty and duplicate startNext inputs without policy normalization", () => {
		const empty = executeTaskRequest(
			state(task(1, "in_progress"), task(2, "pending", [1])),
			{ action: "done", id: 1, startNext: [] },
		);
		assert.equal(empty.state.tasks[1].status, "pending");
		assert.deepEqual(empty.result.details.outcomes, []);
		assert.equal(empty.result.details.partial, false);
		assert.equal(text(empty), "#1 done");

		const request = { action: "done" as const, id: 1, startNext: [2, 2] };
		const received = structuredClone(request);
		const duplicate = executeTaskRequest(
			state(task(1, "in_progress"), task(2, "pending", [1])),
			request,
		);
		assert.deepEqual(request, received);
		assert.equal(duplicate.state.tasks[1].status, "in_progress");
		assert.deepEqual(
			duplicate.result.details.outcomes.map((outcome) => outcome.kind),
			["started", "start_skipped"],
		);
		assert.match(
			duplicate.result.details.outcomes[1]?.message ?? "",
			/in_progress and cannot be started/,
		);
		assert.equal(duplicate.result.details.partial, true);
	});

	it("does not start successors when done itself fails", () => {
		const original = state(task(2));
		const result = executeTaskRequest(original, {
			action: "done",
			id: 1,
			startNext: 2,
		});

		assert.equal(result.changed, false);
		assert.match(result.result.details.error ?? "", /task #1 not found/);
		assert.deepEqual(result.result.details.outcomes, []);
		assert.deepEqual(result.state, original);
		assert.equal(result.state.tasks[0].status, "pending");
	});

	it("rejects malformed and non-done startNext fields before mutation", () => {
		for (const input of [
			{ action: "start", id: 1, startNext: 2 },
			{ action: "expire", id: 1, reason: "obsolete", startNext: [2] },
			{ action: "list", startNext: 2 },
			{ action: "done", id: 1, startNext: "2" },
		]) {
			const original = state(task(1), task(2));
			const result = executeTaskRequest(original, input);
			assert.equal(result.changed, false);
			assert.ok(result.result.details.error);
			assert.deepEqual(result.state, original);
		}
	});

	it("preserves done without startNext and persists a compound handoff once", () => {
		const omitted = executeTaskRequest(state(task(1, "in_progress")), {
			action: "done",
			id: 1,
		});
		assert.deepEqual(omitted.result.details.outcomes, []);
		assert.equal(omitted.result.details.partial, false);
		assert.equal(text(omitted), "#1 done");

		const session = createTaskSession(
			state(task(1, "in_progress"), task(2, "pending", [1])),
		);
		const saved: TaskState[] = [];
		const operation = session.execute(
			{ action: "done", id: 1, startNext: 2 },
			(snapshot) => saved.push(snapshot),
		);
		assert.equal(operation.changed, true);
		assert.equal(saved.length, 1);
		assert.equal(saved[0]?.tasks[1]?.status, "in_progress");
		assert.equal(session.snapshot().tasks[1]?.status, "in_progress");
	});

	it("surfaces scalar and array handoffs in the tool schema and call renderer", () => {
		for (const startNext of [2, [], [2, 2]]) {
			assert.equal(
				Check(TaskToolParameters, { action: "done", id: 1, startNext }),
				true,
			);
		}
		assert.equal(
			Check(TaskToolParameters, { action: "done", id: 1, startNext: "2" }),
			false,
		);
		assert.match(
			renderTaskCall({ action: "done", id: 1, startNext: 2 }, plainTheme)
				.render(80)
				.join("\n"),
			/startNext=\[2\]/,
		);
		assert.match(
			renderTaskCall({ action: "done", id: 1, startNext: [2, 3] }, plainTheme)
				.render(80)
				.join("\n"),
			/startNext=\[2,3\]/,
		);
	});
});
