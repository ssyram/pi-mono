import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	ScriptResult,
	ScriptSpec,
	ScriptTask,
} from "../src/script-tasks/task-spec.js";
import { createTaskDispatcher } from "../src/task-dispatcher.js";

const scripts: ScriptSpec[] = ["one", "two"].map((path) => ({
	path: `/work/${path}`,
	cwd: "/work",
	params: [],
	timeoutSeconds: null,
}));
function result(script: ScriptSpec, success: boolean): ScriptResult {
	return {
		script,
		status: success ? "success" : "failed",
		exitCode: success ? 0 : 1,
		signal: null,
		stdout: script.path,
		stderr: "",
		error: null,
	};
}
function fixture() {
	const messages: {
		customType: string;
		content: unknown;
		details?: unknown;
		options?: { triggerTurn?: boolean };
	}[] = [];
	const notifications: string[] = [];
	const pi = {
		sendMessage: (
			message: Omit<(typeof messages)[number], "options">,
			options?: { triggerTurn?: boolean },
		) => messages.push({ ...message, ...(options ? { options } : {}) }),
		sendUserMessage: () =>
			assert.fail("automatic event must not impersonate user"),
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify: (text: string) => notifications.push(text) },
	} as unknown as ExtensionContext;
	return { pi, ctx, messages, notifications };
}

test("progress tracks current script and I/K/M; all scripts finish before one custom wakeup", async () => {
	const setup = fixture();
	const pending: { script: ScriptSpec; done: (value: ScriptResult) => void }[] =
		[];
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		runner: (script) => new Promise((done) => pending.push({ script, done })),
	});
	dispatcher.dispatch({
		id: "session:batch",
		scope: "session",
		scriptTask: {
			scripts,
			wakeUp: { kind: "on-error", aggregation: "or", prompt: "check failures" },
		},
	});
	assert.equal(dispatcher.list().length, 1);
	assert.equal(dispatcher.list()[0]?.current?.path, "/work/one");
	assert.deepEqual(
		[
			dispatcher.list()[0]?.success,
			dispatcher.list()[0]?.completed,
			dispatcher.list()[0]?.total,
		],
		[0, 0, 2],
	);
	assert.throws(
		() =>
			dispatcher.dispatch({
				id: "session:batch",
				scope: "session",
				prompt: "duplicate",
			}),
		/already running/,
	);
	const first = pending[0];
	assert.ok(first);
	first.done(result(first.script, false));
	await setImmediate();
	assert.equal(dispatcher.list()[0]?.current?.path, "/work/two");
	assert.deepEqual(
		[dispatcher.list()[0]?.success, dispatcher.list()[0]?.completed],
		[0, 1],
	);
	assert.equal(setup.messages.length, 0);
	const second = pending[1];
	assert.ok(second);
	second.done(result(second.script, true));
	await setImmediate();
	assert.equal(dispatcher.list().length, 0);
	assert.equal(setup.messages.length, 1);
	assert.equal(setup.messages[0]?.customType, "loop-task-run");
	assert.equal(setup.messages[0]?.options?.triggerTurn, true);
	assert.match(String(setup.messages[0]?.content), /FAILED/);
});

for (const [wakeUp, shouldWake] of [
	[{ kind: "never" }, false],
	[{ kind: "always", prompt: "x" }, true],
	[{ kind: "on-error", aggregation: "and", prompt: "x" }, false],
] as const) {
	test(`dispatcher applies ${wakeUp.kind} policy without changing execution order`, async () => {
		const setup = fixture();
		const calls: string[] = [];
		const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
			runner: async (script) => {
				calls.push(script.path);
				return result(script, script.path.endsWith("two"));
			},
		});
		const task: ScriptTask = { scripts, wakeUp };
		dispatcher.dispatch({ id: "id", scope: "session", scriptTask: task });
		await setImmediate();
		assert.deepEqual(calls, ["/work/one", "/work/two"]);
		assert.equal(setup.messages.length, 1);
		assert.equal(setup.messages[0]?.options?.triggerTurn, shouldWake);
	});
}

test("shutdown aborts owned work, never publishes late results, and contains callback errors", async () => {
	const setup = fixture();
	let signal: AbortSignal | undefined;
	let finish: (() => void) | undefined;
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		runner: (script, abort) => {
			signal = abort;
			return new Promise((done) => {
				finish = () => done(result(script, false));
			});
		},
		onChange: () => {
			throw new Error("widget failed");
		},
	});
	dispatcher.dispatch({
		id: "closing",
		scope: "session",
		scriptTask: {
			scripts: scripts.slice(0, 1),
			wakeUp: { kind: "always", prompt: "x" },
		},
	});
	dispatcher.dispose();
	assert.equal(signal?.aborted, true);
	assert.ok(finish);
	finish();
	await setImmediate();
	assert.equal(setup.messages.length, 0);
	assert.deepEqual(dispatcher.list(), []);
	assert.ok(
		setup.notifications.some((message) => message.includes("widget failed")),
	);
	assert.throws(
		() => dispatcher.dispatch({ id: "late", scope: "session", prompt: "x" }),
		/inactive/,
	);
});
