import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerTaskGate } from "../hooks/task-gate.js";
import { registerTaskTool } from "../tools/task.js";
import type { TaskBoundaryErrorDetails } from "../tools/task-system/failure.js";
import type { TaskResultDetails } from "../tools/task-system/model.js";

type Hook = (event: unknown, context: ExtensionContext) => unknown;
type Result = AgentToolResult<TaskResultDetails | TaskBoundaryErrorDetails>;
type Definition = {
	execute(
		id: string,
		input: unknown,
		signal: AbortSignal,
		update: () => void,
		context: ExtensionContext,
	): Promise<Result>;
};

function harness() {
	let definition: Definition | undefined;
	const hooks = new Map<string, Hook>();
	let writes = 0;
	const pi = {
		on(name: string, callback: Hook) {
			hooks.set(name, callback);
		},
		registerTool(tool: Definition) {
			definition = tool;
		},
		appendEntry() {
			writes++;
		},
	} as unknown as ExtensionAPI;
	const context = {
		sessionManager: {
			getSessionId: () => "bootstrap",
			getBranch: () => [],
			getEntries: () => [],
		},
	} as unknown as ExtensionContext;
	const owner = registerTaskTool(pi);
	registerTaskGate(pi, owner.getTaskAdmissionState, () => true);
	const gate = hooks.get("tool_call");
	assert.ok(gate);
	assert.ok(definition);
	const tool = definition;
	return {
		owner,
		context,
		get writes() {
			return writes;
		},
		check(name: string) {
			return gate({ toolName: name }, context);
		},
		execute(input: unknown) {
			return tool.execute(
				"call",
				input,
				new AbortController().signal,
				() => {},
				context,
			);
		},
	};
}

test("an empty session can add/start its first model task and then admit ordinary tools", async () => {
	const runtime = harness();
	assert.equal(await runtime.check("task"), undefined);
	assert.notEqual(await runtime.check("read"), undefined);
	const created = await runtime.execute({
		action: "add",
		text: "first task",
		start: true,
	});
	assert.equal(created.details?.error, undefined);
	assert.equal(runtime.owner.getTaskState(runtime.context).inProgressCount, 1);
	assert.equal(runtime.writes, 1);
	assert.equal(await runtime.check("read"), undefined);
});

test("invalid task input does not block a subsequent valid task request", async () => {
	const runtime = harness();
	const invalid = await runtime.execute({ action: "add", text: "" });
	assert.ok(invalid.details?.error);
	assert.equal(runtime.writes, 0);
	assert.equal(await runtime.check("task"), undefined);
	const created = await runtime.execute({
		action: "add",
		text: "retry",
		start: true,
	});
	assert.equal(created.details?.error, undefined);
	assert.equal(runtime.writes, 1);
	assert.equal(await runtime.check("read"), undefined);
});
