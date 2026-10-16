import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { registerTaskGate } from "../hooks/task-gate.js";
import { registerTaskTool } from "../tools/task.js";
import type { TaskState } from "../tools/task-system/model.js";
import { entry } from "./task-system-fixtures.js";

type Hook = (event: unknown, context: ExtensionContext) => unknown;

for (const failedRead of ["branch", "history"] as const) {
	test(`failed ${failedRead} restoration cannot admit tools using retained old tasks`, async (t) => {
		t.mock.method(console, "error", () => {
			throw new Error("diagnostic unavailable");
		});
		let unavailable = false;
		const journal: SessionEntry[] = [];
		const hooks = new Map<string, Hook[]>();
		const pi = {
			on(name: string, callback: Hook) {
				hooks.set(name, [...(hooks.get(name) ?? []), callback]);
			},
			registerTool() {},
			appendEntry(_type: string, snapshot: TaskState) {
				journal.push(entry(snapshot));
			},
		} as unknown as ExtensionAPI;
		const context = {
			sessionManager: {
				getSessionId: () => "admission-session",
				getBranch() {
					if (unavailable && failedRead === "branch")
						throw new Error("unreadable branch");
					return journal;
				},
				getEntries() {
					if (unavailable && failedRead === "history")
						throw new Error("unreadable history");
					return journal;
				},
			},
		} as unknown as ExtensionContext;
		const controller = registerTaskTool(pi);
		registerTaskGate(pi, controller.getTaskAdmissionState, () => true);
		const gate = hooks.get("tool_call")?.[0];
		assert.ok(gate);
		controller.runHumanTaskCommand("add work --start", context);
		assert.equal(await gate({ toolName: "read" }, context), undefined);
		unavailable = true;
		for (const hook of hooks.get("session_tree") ?? []) await hook({}, context);
		assert.equal(controller.getTaskState(context).inProgressCount, 1);
		const refused = await gate({ toolName: "read" }, context);
		assert.ok(typeof refused === "object" && refused !== null);
		assert.equal("block" in refused && refused.block, true);
		assert.equal(await gate({ toolName: "task" }, context), undefined);
		assert.ok(controller.runHumanTaskCommand("list", context).details?.error);
		unavailable = false;
		assert.equal(
			controller.runHumanTaskCommand("list", context).details?.error,
			undefined,
		);
		assert.equal(await gate({ toolName: "read" }, context), undefined);
		assert.equal(journal.length, 1);
	});
}
