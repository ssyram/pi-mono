import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import {
	taskAdmission,
	taskAvailabilityProblem,
} from "../tools/task-system/admission.js";
import { createTaskSession } from "../tools/task-system/session.js";
import {
	createTaskToolDefinition,
	TaskToolParameters,
} from "../tools/task-system/tool-definition.js";
import { state, task } from "./task-system-fixtures.js";

describe("dormant tool definition and admission", () => {
	it("exempts only exact task before attempting to read state", () => {
		assert.equal(
			taskAdmission("task", () => {
				throw new Error("must not read");
			}),
			undefined,
		);
		for (const name of [
			"read",
			"bash",
			"write",
			"subagent",
			"contact_supervisor",
			"bg_wait",
			"parallel",
			"Task",
			"task.other",
			"new-tool",
		]) {
			const refusal = taskAdmission(name, () => []);
			assert.equal(refusal?.block, true);
			assert.equal("terminate" in (refusal ?? {}), false);
			assert.match(refusal?.reason ?? "", /task/);
		}
	});
	it("requires started and unblocked work, independently for each state reader", () => {
		for (const snapshot of [
			state(),
			state(task(1)),
			state(task(1, "done")),
			state(task(1, "expired")),
			state(task(1), task(2, "pending", [1])),
			state(task(1), task(2, "in_progress", [1])),
		]) {
			assert.equal(taskAdmission("read", () => snapshot.tasks)?.block, true);
		}
		assert.equal(
			taskAdmission("read", () => state(task(1, "in_progress")).tasks),
			undefined,
		);
		assert.equal(
			taskAdmission(
				"read",
				() => state(task(1, "done"), task(2, "in_progress", [1])).tasks,
			),
			undefined,
		);
	});
	it("reports missing task availability without trying to override a tool allowlist", () => {
		assert.equal(taskAvailabilityProblem(["task", "read"]), undefined);
		assert.match(
			taskAvailabilityProblem(["read", "bash", "write"]) ?? "",
			/allowlist excludes/,
		);
	});
	it("offers an unregistered sequential definition and rejects clear in its schema", async () => {
		const session = createTaskSession();
		let writes = 0;
		const context = {} as ExtensionContext;
		const definition = createTaskToolDefinition((input, received) => {
			assert.equal(received, context);
			return session.execute(input, () => writes++);
		});
		assert.equal(definition.name, "task");
		assert.equal(definition.executionMode, "sequential");
		assert.equal(Check(TaskToolParameters, { action: "clear" }), false);
		assert.equal(
			Check(TaskToolParameters, {
				action: "add",
				tasks: [{ text: "next", start: true, blockedBy: ["forward"] }],
			}),
			true,
		);
		const added = await definition.execute(
			"id",
			{ action: "add", text: "work", start: true },
			undefined,
			undefined,
			context,
		);
		assert.ok("tasks" in added.details);
		assert.equal(added.details.tasks[0].status, "in_progress");
		assert.equal(writes, 1);
		assert.equal(
			taskAdmission("read", () => session.snapshot().tasks),
			undefined,
		);
		await definition.execute(
			"id2",
			{ action: "done", id: 1 },
			undefined,
			undefined,
			context,
		);
		assert.equal(
			taskAdmission("write", () => session.snapshot().tasks)?.block,
			true,
		);
	});
	it("returns persistence errors without pretending partial success", async () => {
		const session = createTaskSession();
		const definition = createTaskToolDefinition((input) =>
			session.execute(input, () => {
				throw new Error("persistence unavailable");
			}),
		);
		const result = await definition.execute(
			"id",
			{ action: "add", text: "work" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);
		assert.match(result.details.error ?? "", /persistence failed/);
		assert.ok("partial" in result.details);
		assert.equal(result.details.partial, false);
		assert.deepEqual(session.snapshot(), { tasks: [], nextId: 2 });
	});
});
