import assert from "node:assert/strict";
import { test } from "node:test";
import { executeScriptTask } from "../src/script-tasks/execute-task.js";
import type {
	ScriptResult,
	ScriptSpec,
	ScriptTask,
	WakeUpSetting,
} from "../src/script-tasks/task-spec.js";
import { shouldWakeUp } from "../src/script-tasks/wake-up-policy.js";

const script: ScriptSpec = {
	cwd: "/tmp",
	path: "/bin/sh",
	params: [],
	timeoutSeconds: null,
};
function result(status: ScriptResult["status"], spec = script): ScriptResult {
	return {
		script: spec,
		status,
		exitCode: status === "success" ? 0 : 1,
		signal: null,
		stdout: "",
		stderr: "",
		error: null,
	};
}

test("exhaustive truth tables for every success/failure vector up to eight scripts", () => {
	for (let length = 0; length <= 8; length++) {
		for (let bits = 0; bits < 2 ** length; bits++) {
			const results = Array.from({ length }, (_, i) =>
				result(bits & (1 << i) ? "failed" : "success"),
			);
			assert.equal(shouldWakeUp({ kind: "never" }, results), false);
			assert.equal(shouldWakeUp({ kind: "always", prompt: "" }, results), true);
			assert.equal(
				shouldWakeUp(
					{ kind: "on-error", aggregation: "or", prompt: "" },
					results,
				),
				bits !== 0,
			);
			assert.equal(
				shouldWakeUp(
					{ kind: "on-error", aggregation: "and", prompt: "" },
					results,
				),
				length > 0 && bits === 2 ** length - 1,
			);
		}
	}
});

test("every non-success terminal status is an error", () => {
	for (const status of ["failed", "timeout", "start-failed"] as const) {
		assert.equal(
			shouldWakeUp({ kind: "on-error", aggregation: "or", prompt: "x" }, [
				result("success"),
				result(status),
			]),
			true,
		);
		assert.equal(
			shouldWakeUp({ kind: "on-error", aggregation: "and", prompt: "x" }, [
				result("success"),
				result(status),
			]),
			false,
		);
	}
});

test("execute every script once in order for all policies, retaining failures", async () => {
	const policies: WakeUpSetting[] = [
		{ kind: "never" },
		{ kind: "always", prompt: "x" },
		{ kind: "on-error", aggregation: "or", prompt: "x" },
		{ kind: "on-error", aggregation: "and", prompt: "x" },
	];
	for (const wakeUp of policies) {
		const task: ScriptTask = {
			wakeUp,
			scripts: Array.from({ length: 5 }, (_, i) => ({
				...script,
				params: [String(i)],
			})),
		};
		const calls: string[] = [];
		let active = 0;
		const run = await executeScriptTask(task, "wake-42", async (spec) => {
			assert.equal(active, 0);
			active++;
			const param = spec.params[0];
			assert.equal(typeof param, "string");
			assert.ok(param !== undefined);
			calls.push(param);
			await Promise.resolve();
			active--;
			return result(spec.params[0] === "4" ? "success" : "failed", spec);
		});
		assert.deepEqual(calls, ["0", "1", "2", "3", "4"]);
		assert.equal(run.results.length, task.scripts.length);
		assert.equal(run.successCount, 1);
		assert.equal(run.wakeUpId, "wake-42");
		assert.equal(
			run.shouldWake,
			wakeUp.kind === "always" ||
				(wakeUp.kind === "on-error" && wakeUp.aggregation === "or"),
		);
	}
});

test("pure prompt task calls no runner and still builds content", async () => {
	const run = await executeScriptTask(
		{ wakeUp: { kind: "always", prompt: "continue" }, scripts: [] },
		"pure",
		async () => {
			throw new Error("must not run");
		},
	);
	assert.equal(run.shouldWake, true);
	assert.equal(run.successCount, 0);
	assert.equal(run.results.length, 0);
	assert.match(run.content, /<prompts>\ncontinue\n<\/prompts>/);
});
