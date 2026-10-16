import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerTaskGate } from "../hooks/task-gate.js";
import { registerTaskTool } from "../tools/task.js";
import { taskSettingsFixture } from "./task-settings-fixture.js";

type Hook = (event: { toolName: string }, context: ExtensionContext) => unknown;

test("real settings service and task owner bootstrap without an existing task; service loss never blocks task itself", async (t) => {
	const h = await taskSettingsFixture(t);
	const hooks = new Map<string, Hook>();
	const manager = h.context.sessionManager;
	Object.assign(manager, { getBranch: h.branch, getEntries: h.branch });
	const pi = {
		events: h.bus,
		on(name: string, callback: Hook) {
			hooks.set(name, callback);
		},
		registerTool() {},
		appendEntry(customType: string, data: unknown) {
			h.branch().push({ type: "custom", customType, data });
		},
	} as unknown as ExtensionAPI;
	const owner = registerTaskTool(pi);
	registerTaskGate(pi, owner.getTaskAdmissionState, h.settings.isEnabled);
	const gate = hooks.get("tool_call");
	assert.ok(gate);
	assert.equal(await gate({ toolName: "task" }, h.context), undefined);
	assert.notEqual(await gate({ toolName: "read" }, h.context), undefined);
	assert.equal(
		owner.runHumanTaskCommand("add first --start", h.context).details?.error,
		undefined,
	);
	assert.equal(await gate({ toolName: "read" }, h.context), undefined);
	assert.equal(
		(await h.settings.set(h.context, "omp-task:show", false)).applied,
		true,
	);
	assert.equal(
		(await h.settings.set(h.context, "omp-task:no-task-no-tool", false))
			.applied,
		true,
	);
	assert.equal(
		owner.runHumanTaskCommand("clear --CONFIRMED", h.context).details?.error,
		undefined,
	);
	assert.equal(await gate({ toolName: "read" }, h.context), undefined);
	h.dispose();
	assert.equal(await gate({ toolName: "task" }, h.context), undefined);
	const rejected = await gate({ toolName: "read" }, h.context);
	assert.ok(
		typeof rejected === "object" && rejected !== null && "reason" in rejected,
	);
	assert.match(String(rejected.reason), /install and enable/);
});
