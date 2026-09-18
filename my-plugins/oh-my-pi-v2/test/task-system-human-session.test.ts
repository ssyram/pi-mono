import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Check } from "typebox/value";
import { taskAdmission } from "../tools/task-system/admission.js";
import { executeTaskRequest } from "../tools/task-system/execute.js";
import { executeHumanTaskCommand } from "../tools/task-system/human-execute.js";
import type { TaskListType, TaskState } from "../tools/task-system/model.js";
import { createTaskSession } from "../tools/task-system/session.js";
import { TaskToolParameters } from "../tools/task-system/tool-definition.js";
import { state, task, text } from "./task-system-fixtures.js";

describe("dormant human session operations", () => {
	it("shares model/human state and bypasses model admission without a second store", () => {
		const session = createTaskSession();
		let writes = 0;
		const persist = () => writes++;
		assert.equal(
			taskAdmission("read", () => session.snapshot().tasks)?.block,
			true,
		);
		const first = session.executeHuman('add "调查问题" --start', persist);
		assert.equal(first.result.details.tasks[0].status, "in_progress");
		assert.equal(
			taskAdmission("read", () => session.snapshot().tasks),
			undefined,
		);
		session.execute(
			{ action: "add", text: "model task", blockedBy: [1] },
			persist,
		);
		assert.equal(
			session.executeHuman("list --type blocked", persist).result.details
				.tasks[0].id,
			2,
		);
		session.executeHuman("modify 1 --status done", persist);
		assert.equal(
			session.execute({ action: "list", type: "ready" }, persist).result.details
				.tasks[0].id,
			2,
		);
		assert.equal(writes, 3);
		assert.deepEqual(createTaskSession().snapshot(), { tasks: [], nextId: 1 });
	});
	it("commits a combined successful text/dependency/start update exactly once", () => {
		const initial = state(task(1, "done"), task(2));
		const session = createTaskSession(initial);
		const saved: TaskState[] = [];
		const operation = session.executeHuman(
			'modify 2 --text "new text" --blocked-by 1 --status in_progress',
			(s) => saved.push(s),
		);
		assert.equal(saved.length, 1);
		assert.equal(operation.changed, true);
		assert.match(text(operation), /already done/);
		assert.match(text(operation), /text updated/);
		assert.match(text(operation), /started/);
		assert.deepEqual(session.snapshot().tasks[1].blockedBy, [1]);
		assert.equal(session.snapshot().tasks[1].status, "in_progress");
		assert.equal(session.snapshot().tasks[1].text, "new text");
		assert.deepEqual(initial, state(task(1, "done"), task(2)));
		saved[0].tasks[1].text = "mutated persistence argument";
		operation.state.tasks[1].blockedBy.length = 0;
		operation.result.details.tasks[1].text = "mutated result";
		assert.equal(session.snapshot().tasks[1].text, "new text");
		assert.deepEqual(session.snapshot().tasks[1].blockedBy, [1]);
	});
	it("rolls back all candidate changes on dependency or start failure", () => {
		for (const command of [
			"modify 2 --text changed --blocked-by 1 --status in_progress",
			"modify 2 --text changed --blocked-by 999 --status done",
			"modify 2 --text changed --blocked-by 2",
			"modify 2 --text changed --blocked-by 1,1",
			"modify 1 --text changed --blocked-by 2",
			"modify 99 --text changed",
		]) {
			const initial = state(task(1), task(2, "pending", [1]));
			const session = createTaskSession(initial);
			const result = session.executeHuman(command, () =>
				assert.fail("rejection must not persist"),
			);
			assert.equal(result.changed, false, command);
			assert.ok(result.result.details.error, command);
			assert.match(text(result), /no changes applied/);
			assert.deepEqual(session.snapshot(), initial, command);
			assert.deepEqual(result.state, initial, command);
			assert.deepEqual(result.result.details.outcomes, []);
		}
	});
	it("keeps scalar add atomic including requested start and dependencies", () => {
		const session = createTaskSession(state(task(1)));
		assert.ok(
			session.executeHuman("add work --blocked-by 1 --start", () =>
				assert.fail(),
			).result.details.error,
		);
		assert.deepEqual(session.snapshot(), state(task(1)));
		session.executeHuman('add "实现修改" --blocked-by 1', () => {});
		assert.equal(
			session.executeHuman("list --type blocked", () => assert.fail()).result
				.details.tasks[0].id,
			2,
		);
	});
	it("demotes running tasks on new blockers and requires an explicit start after clearing", () => {
		const session = createTaskSession(state(task(1), task(2, "in_progress")));
		const blocked = session.executeHuman("modify 2 --blocked-by 1", () => {});
		assert.match(text(blocked), /moved from in_progress to blocked/);
		assert.equal(session.snapshot().tasks[1].status, "pending");
		session.executeHuman('modify 2 --blocked-by ""', () => {});
		assert.equal(
			session.executeHuman("list --type ready", () => {}).result.details.tasks
				.length,
			2,
		);
		session.executeHuman("modify 2 --status in_progress", () => {});
		assert.equal(session.snapshot().tasks[1].status, "in_progress");
	});
	it("preserves graph/closure ordering on text edits and uses lifecycle closure order/reasons", () => {
		const session = createTaskSession(state(task(1), task(2, "pending", [1])));
		session.executeHuman(
			'modify 1 --status expired --reason "no longer needed"',
			() => {},
		);
		session.executeHuman("modify 2 --status done", () => {});
		const before = session.snapshot();
		session.executeHuman('modify 1 --text "new description"', () => {});
		const after = session.snapshot();
		assert.deepEqual(after.tasks[0], {
			...before.tasks[0],
			text: "new description",
			updatedAt: after.tasks[0].updatedAt,
		});
		assert.equal(after.tasks[0].expireReason, "no longer needed");
		assert.equal(after.tasks[0].closedOrder, 1);
		assert.equal(after.tasks[1].closedOrder, 2);
		assert.ok(
			session.executeHuman("modify 1 --status in_progress", () => assert.fail())
				.result.details.error,
		);
		session.executeHuman("modify 1 --status done", () => {});
		assert.equal(session.snapshot().tasks[0].closedOrder, 3);
		assert.deepEqual(
			session
				.executeHuman("list --type closed", () => assert.fail())
				.result.details.tasks.map((t) => t.id),
			[1, 2],
		);
	});
	it("rejects missing/blank expiry reasons and closure exhaustion without text changes", () => {
		const initial = state(
			{ ...task(1, "done"), closedOrder: Number.MAX_SAFE_INTEGER },
			task(2),
		);
		for (const command of [
			"modify 2 --text changed --status done",
			"modify 2 --text changed --status expired",
			'modify 2 --status expired --reason " "',
		]) {
			const result = executeHumanTaskCommand(initial, command);
			assert.equal(result.changed, false);
			assert.deepEqual(result.state, initial);
		}
	});
	it("matches all model list views without truncating state or persisting", () => {
		const initial = state(
			task(1),
			task(2, "in_progress"),
			task(3, "pending", [1]),
			...Array.from({ length: 15 }, (_, i) => ({
				...task(i + 4, i % 2 ? "done" : "expired"),
				closedOrder: i + 1,
			})),
		);
		const session = createTaskSession(initial);
		const types: (TaskListType | undefined)[] = [
			undefined,
			"open",
			"closed",
			"in_progress",
			"ready",
			"blocked",
			"done",
			"expired",
		];
		for (const type of types) {
			for (const limit of type ? [undefined, 0, 2] : [undefined]) {
				const command = `list${type ? ` --type ${type}` : ""}${limit === undefined ? "" : ` --limit ${limit}`}`;
				const human = session.executeHuman(command, () => assert.fail());
				const model = executeTaskRequest(initial, {
					action: "list",
					...(type ? { type } : {}),
					...(limit === undefined ? {} : { limit }),
				});
				assert.deepEqual(human, model);
				assert.deepEqual(session.snapshot(), initial);
			}
		}
	});
	it("clear preserves high-water and model clear/modify remain forbidden", () => {
		const session = createTaskSession(state(task(8)));
		let writes = 0;
		session.executeHuman("clear --CONFIRMED", () => writes++);
		assert.deepEqual(session.snapshot(), { tasks: [], nextId: 9 });
		session.execute({ action: "add", text: "next" }, () => writes++);
		assert.equal(session.snapshot().tasks[0].id, 9);
		for (const input of [
			{ action: "clear" },
			{ action: "modify", id: 9, text: "forbidden" },
		]) {
			assert.equal(Check(TaskToolParameters, input), false);
			assert.ok(
				session.execute(input, () => assert.fail()).result.details.error,
			);
		}
		assert.equal(writes, 2);
	});
	it("reports persistence failures, preserves records and reserves issued IDs", () => {
		const session = createTaskSession(state(task(1)));
		const fail = () => {
			throw new Error("disk failure");
		};
		for (const command of [
			"modify 1 --text changed --status done",
			"clear --CONFIRMED",
		]) {
			const result = session.executeHuman(command, fail);
			assert.equal(result.changed, false);
			assert.match(result.result.details.error ?? "", /persistence failed/);
		}
		assert.deepEqual(session.snapshot(), state(task(1)));
		assert.match(
			session.executeHuman("add next --start", fail).result.details.error ?? "",
			/persistence failed/,
		);
		assert.deepEqual(session.snapshot(), { ...state(task(1)), nextId: 3 });
		session.execute({ action: "add", text: "next model" }, () => {});
		assert.equal(session.snapshot().tasks[1].id, 3);
	});
});
