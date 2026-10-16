import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerTaskWidgetLifecycle } from "../hooks/task-widget-lifecycle.js";
import { registerTaskTool } from "../tools/task.js";

type Hook = (event: unknown, context: ExtensionContext) => unknown;
const hostile = {
	toString(): never {
		throw new Error("description failed");
	},
};

function harness(failure?: "session" | "branch" | "widget") {
	const hooks = new Map<string, Hook[]>();
	const appended: unknown[] = [];
	const widgets: unknown[] = [];
	const pi = {
		on(name: string, handler: Hook) {
			hooks.set(name, [...(hooks.get(name) ?? []), handler]);
		},
		registerTool() {},
		appendEntry(_type: string, data: unknown) {
			appended.push(data);
		},
	} as unknown as ExtensionAPI;
	const context = {
		sessionManager: {
			getSessionId() {
				if (failure === "session") throw hostile;
				return "cca-test";
			},
			getBranch() {
				if (failure === "branch") throw hostile;
				return [];
			},
			getEntries: () => [],
		},
		ui: {
			setWidget(_key: string, value: unknown) {
				if (failure === "widget") throw hostile;
				widgets.push(value);
			},
		},
	} as unknown as ExtensionContext;
	const handle = registerTaskTool(pi);
	registerTaskWidgetLifecycle(pi, (ctx) => {
		handle.getTaskState(ctx);
		ctx.sessionManager.getBranch();
		ctx.ui.setWidget("omp-tasks", undefined);
	});
	return {
		context,
		handle,
		appended,
		widgets,
		async emit(name: string) {
			for (const hook of hooks.get(name) ?? []) await hook({}, context);
		},
	};
}

for (const failure of ["session", "branch", "widget"] as const) {
	test(`task lifecycle contains ${failure} and diagnostic failures without a Pi catch`, async (t) => {
		t.mock.method(console, "error", () => {
			throw hostile;
		});
		const runtime = harness(failure);
		for (const event of ["session_start", "session_tree", "session_shutdown"]) {
			await assert.doesNotReject(runtime.emit(event));
		}
		assert.equal(runtime.appended.length, 0);
	});
}

test("widget lifecycle contains asynchronous settings or rendering rejection", async (t) => {
	t.mock.method(console, "error", () => {
		throw hostile;
	});
	const hooks = new Map<string, Hook>();
	registerTaskWidgetLifecycle(
		{
			on(name: string, hook: Hook) {
				hooks.set(name, hook);
			},
		} as unknown as ExtensionAPI,
		async () => {
			throw hostile;
		},
	);
	for (const event of ["session_start", "session_tree"]) {
		await assert.doesNotReject(
			Promise.resolve(hooks.get(event)?.({}, {} as ExtensionContext)),
		);
	}
});

test("widget lifecycle preserves refresh and shutdown registration", async () => {
	const runtime = harness();
	for (const event of ["session_start", "session_tree", "session_shutdown"])
		await runtime.emit(event);
	assert.deepEqual(runtime.widgets, [undefined, undefined, undefined]);
});

test("failed task notification cannot undo committed state or escape through its logger", (t) => {
	t.mock.method(console, "error", () => {
		throw hostile;
	});
	const runtime = harness();
	runtime.handle.setOnTaskChange(() => {
		throw hostile;
	});
	const result = runtime.handle.runHumanTaskCommand(
		"add work",
		runtime.context,
	);
	assert.equal(result.details?.action, "add");
	assert.equal(result.details?.error, undefined);
	assert.equal(runtime.appended.length, 1);
	assert.equal(
		runtime.handle.getTaskState(runtime.context).tasks[0]?.text,
		"work",
	);
});
