import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskState } from "../tools/task-system/model.js";
import { createTaskSession } from "../tools/task-system/session.js";
import {
	clearTaskState,
	parseTaskState,
	restoreTaskState,
} from "../tools/task-system/state.js";
import { entry, state, task } from "./task-system-fixtures.js";

describe("dormant state restore and session ownership", () => {
	it("restores branch tasks but reserves IDs across session history", () => {
		const old = entry(state(task(1)));
		const sibling = entry(state(task(99)));
		const restored = restoreTaskState([old], [old, sibling]);
		assert.deepEqual(
			restored.tasks.map((item) => item.id),
			[1],
		);
		assert.equal(restored.nextId, 100);
		assert.deepEqual(restoreTaskState([], [sibling]), {
			tasks: [],
			nextId: 100,
		});
		assert.equal(restoreTaskState([old], [old], 120).nextId, 120);
	});
	it("preserves optional closure order, rejects malformed snapshots and retains earlier valid branch state", () => {
		const snapshot = state({
			...task(1, "done"),
			closedOrder: 4,
			expireReason: undefined,
		});
		assert.deepEqual(parseTaskState(snapshot), snapshot);
		assert.ok(parseTaskState(state(task(1))));
		for (const data of [
			{ ...snapshot, nextId: 1 },
			state({ ...task(1), closedOrder: -1 }),
			{
				tasks: [task(Number.MAX_SAFE_INTEGER + 1)],
				nextId: Number.MAX_SAFE_INTEGER + 2,
			},
			state(task(1, "pending", [999])),
		]) {
			assert.equal(parseTaskState(data), undefined);
		}
		const invalid = { ...entry(snapshot), data: { nonsense: true } };
		assert.deepEqual(
			restoreTaskState([entry(snapshot), invalid], [entry(snapshot), invalid]),
			snapshot,
		);
	});
	it("human clearing preserves IDs and branch navigation cannot lower a live reservation", () => {
		const session = createTaskSession(state(task(7)));
		const writes: TaskState[] = [];
		session.clear((snapshot) => writes.push(snapshot));
		assert.deepEqual(session.snapshot(), { tasks: [], nextId: 8 });
		session.restore([], []);
		const result = session.execute(
			{ action: "add", text: "next" },
			(snapshot) => writes.push(snapshot),
		);
		assert.equal(result.state.tasks[0].id, 8);
		assert.equal(writes.length, 2);
		assert.deepEqual(clearTaskState(state(task(4))), { tasks: [], nextId: 5 });
	});
	it("commits batch once, never writes lists/rejections, and isolates returned snapshots", () => {
		const session = createTaskSession();
		let writes = 0;
		const result = session.execute(
			{ action: "add", tasks: [{ text: "a" }, { text: "b" }] },
			() => writes++,
		);
		assert.equal(writes, 1);
		result.state.tasks[0].text = "tampered";
		const snapshot = session.snapshot();
		snapshot.tasks.length = 0;
		assert.equal(session.snapshot().tasks[0].text, "a");
		session.execute({ action: "list" }, () => writes++);
		session.execute({ action: "clear" }, () => writes++);
		session.execute({ action: "start", id: 999 }, () => writes++);
		assert.equal(writes, 1);
	});
	it("preserves issued high-water on persistence failure without claiming native-log rollback", () => {
		const session = createTaskSession();
		let observable: TaskState | undefined;
		const failed = session.execute(
			{ action: "add", text: "failed append" },
			(snapshot) => {
				observable = snapshot;
				throw new Error("disk failure");
			},
		);
		assert.equal(failed.changed, false);
		assert.match(
			failed.result.details.error ?? "",
			/Native log\/disk outcome is uncertain/,
		);
		assert.deepEqual(failed.state, { tasks: [], nextId: 2 });
		assert.equal(observable?.tasks[0].id, 1);
		assert.deepEqual(session.snapshot(), { tasks: [], nextId: 2 });
		const result = session.execute({ action: "add", text: "next" }, () => {});
		assert.equal(result.state.tasks[0].id, 2);
	});
	it("fork copies remain independent under separate session owners", () => {
		const original = state(task(1));
		const first = createTaskSession(original);
		const fork = createTaskSession(original);
		first.execute({ action: "done", id: 1 }, () => {});
		fork.execute({ action: "add", text: "fork only" }, () => {});
		assert.equal(first.snapshot().tasks.length, 1);
		assert.equal(fork.snapshot().tasks[0].status, "pending");
		assert.deepEqual(original, state(task(1)));
	});
});
