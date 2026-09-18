import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeTaskRequest } from "../tools/task-system/execute.js";
import { parseTaskState } from "../tools/task-system/state.js";
import { state, task, text } from "./task-system-fixtures.js";

describe("dormant task batch creation", () => {
	it("creates forward aliases, skips only cycle-closing edges and starts after all edges", () => {
		const before = state();
		const input = {
			action: "add",
			tasks: [
				{ key: "a", text: "A", blockedBy: ["b"], start: true },
				{ key: "b", text: "B", blockedBy: ["a"], start: true },
			],
		};
		const original = structuredClone(input);
		const result = executeTaskRequest(before, input);
		assert.deepEqual(input, original);
		assert.deepEqual(before, state());
		assert.equal(result.changed, true);
		assert.equal(result.result.details.partial, true);
		assert.equal(result.result.details.error, undefined);
		assert.deepEqual(
			result.state.tasks.map((item) => [
				item.id,
				item.status,
				item.blockedBy,
				item.blocks,
			]),
			[
				[1, "pending", [2], []],
				[2, "in_progress", [], [1]],
			],
		);
		assert.match(text(result), /Partially applied/);
		assert.match(text(result), /circular dependency/);
		assert.match(text(result), /created but not started/);
		assert.ok(parseTaskState(result.state));
	});
	it("skips bad items and bad edges, preserves earlier valid duplicate-key binding", () => {
		const result = executeTaskRequest(state(task(9)), {
			action: "add",
			tasks: [
				{ key: "", text: "invalid" },
				{ key: "a", text: "A" },
				{ key: "a", text: "duplicate" },
				{ text: "  " },
				{ text: "B", blockedBy: ["a", "missing", 10, 999, 9, 9] },
			],
		});
		assert.deepEqual(
			result.state.tasks.map((item) => item.id),
			[9, 10, 11],
		);
		assert.deepEqual(result.state.tasks[2].blockedBy, [10, 9]);
		assert.equal(result.state.nextId, 12);
		assert.equal(
			result.result.details.outcomes.filter(
				(item) => item.kind === "skipped_item",
			).length,
			3,
		);
		assert.equal(
			result.result.details.outcomes.filter(
				(item) => item.kind === "edge_skipped",
			).length,
			4,
		);
		assert.ok(parseTaskState(result.state));
	});
	it("reports accepted done and expired edges as already satisfied and starts", () => {
		const result = executeTaskRequest(
			state(task(1, "done"), task(2, "expired")),
			{
				action: "add",
				tasks: [{ text: "next", blockedBy: [1, 2], start: true }],
			},
		);
		assert.equal(result.result.details.partial, false);
		assert.equal(result.state.tasks[2].status, "in_progress");
		assert.deepEqual(result.state.tasks[2].blockedBy, [1, 2]);
		assert.match(
			text(result),
			/edge added; prerequisite already done, already satisfied; blocking state unchanged/,
		);
		assert.match(text(result), /prerequisite already expired/);
	});
	it("rejects self-edges and duplicate edges without rolling back creation", () => {
		const result = executeTaskRequest(state(), {
			action: "add",
			tasks: [
				{ key: "x", text: "x", blockedBy: ["x"] },
				{ text: "y", blockedBy: ["x", "x"] },
			],
		});
		assert.equal(result.state.tasks.length, 2);
		assert.deepEqual(result.state.tasks[1].blockedBy, [1]);
		assert.equal(
			result.result.details.outcomes.filter(
				(item) => item.kind === "edge_skipped",
			).length,
			2,
		);
	});
	it("does not publish scalar shortcut partial effects", () => {
		for (const request of [
			{ action: "add", text: "x", blockedBy: [999] },
			{ action: "add", text: "x", blockedBy: [1], start: true },
		]) {
			const original = state(task(1));
			const result = executeTaskRequest(original, request);
			assert.deepEqual(result.state, original);
			assert.equal(result.changed, false);
			assert.ok(result.result.details.error);
		}
	});
	it("reports all-invalid semantic batches without consuming IDs", () => {
		const original = state();
		const result = executeTaskRequest(original, {
			action: "add",
			tasks: [{ text: "" }, { key: " ", text: "x" }],
		});
		assert.deepEqual(result.state, original);
		assert.equal(result.changed, false);
		assert.equal(result.result.details.partial, true);
		assert.match(text(result), /^Nothing applied:/);
	});
	it("requires well-shaped requests and rejects the removed model clear", () => {
		for (const input of [
			{ action: "clear" },
			{ action: "add", tasks: [] },
			{ action: "add", tasks: [{ text: 1 }] },
			{ action: "add", text: "a", tasks: [{ text: "b" }] },
			{ action: "add", tasks: [{ text: "x", blockedBy: [{}] }] },
		]) {
			const result = executeTaskRequest(state(task(1)), input);
			assert.ok(result.result.details.error);
			assert.equal(result.changed, false);
			assert.equal(result.state.tasks.length, 1);
		}
	});
	it("skips missing text and unsafe numeric references as local batch issues", () => {
		const result = executeTaskRequest(state(), {
			action: "add",
			tasks: [
				{ key: "missing" },
				{
					text: "kept",
					blockedBy: [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "missing"],
				},
			],
		});
		assert.equal(result.state.tasks.length, 1);
		assert.equal(result.state.tasks[0].text, "kept");
		assert.equal(
			result.result.details.outcomes.filter(
				(item) => item.kind === "edge_skipped",
			).length,
			5,
		);
		assert.equal(result.result.details.partial, true);
	});
	it("stops allocation safely without losing the last valid allocated task", () => {
		const before = { tasks: [], nextId: Number.MAX_SAFE_INTEGER - 1 };
		const result = executeTaskRequest(before, {
			action: "add",
			tasks: [{ text: "last usable" }, { text: "exhausted" }],
		});
		assert.equal(result.state.tasks.length, 1);
		assert.equal(result.state.nextId, Number.MAX_SAFE_INTEGER);
		assert.equal(result.result.details.partial, true);
		assert.ok(parseTaskState(result.state));
	});
	it("uses exact safe Map keys and keeps aliases invocation-local", () => {
		const first = executeTaskRequest(state(), {
			action: "add",
			tasks: [
				{ key: "__proto__", text: "a" },
				{ key: "constructor", text: "b", blockedBy: ["__proto__"] },
			],
		});
		const second = executeTaskRequest(first.state, {
			action: "add",
			tasks: [{ text: "c", blockedBy: ["constructor"] }],
		});
		assert.deepEqual(first.state.tasks[1].blockedBy, [1]);
		assert.equal(second.result.details.partial, true);
		assert.deepEqual(second.state.tasks[2].blockedBy, []);
	});
});
