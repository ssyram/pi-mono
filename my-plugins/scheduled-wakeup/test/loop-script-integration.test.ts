import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import type { TaskRun } from "../src/script-tasks/task-spec.js";
import { createBoundaryFixture } from "./outer-boundary-fixture.js";

async function until(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 500 && !predicate(); i++) await setTimeout(10);
	assert.ok(predicate(), "expected asynchronous result");
}

test(
	"CLI manual script run uses real processes, custom NoWake output, and leaves schedule progress unchanged",
	{ timeout: 10_000 },
	async (t) => {
		const setup = createBoundaryFixture(t);
		await setup.start();
		const spec = JSON.stringify({
			path: process.execPath,
			params: ["-e", "process.stdout.write('from-script')"],
		});
		await setup.run(`add --script ${spec} --wake never once 1h`);
		const active = (await setup.execute({ action: "list" })).details
			.active?.[0];
		assert.ok(active?.kind === "session");
		await setup.run(`run ${active.task.definition.id}`);
		await until(() => setup.messages.length === 1);
		const message = setup.messages[0];
		assert.ok(message);
		assert.equal(message.options?.triggerTurn, false);
		assert.equal(message.customType, "loop-task-run");
		assert.match(String(message.content), /from-script/);
		const run = message.details as TaskRun;
		assert.equal(run.successCount, 1);
		assert.equal(run.results.length, 1);
		assert.equal(
			(await setup.execute({ action: "list" })).details.active?.[0]?.kind,
			"session",
		);
		const latest = (await setup.execute({ action: "list" })).details
			.active?.[0];
		assert.ok(latest?.kind === "session");
		assert.equal(latest.task.progress.runCount, 0);
	},
);

test(
	"tool script preparation, actual timer dispatch and immediate run-count advancement work together",
	{ timeout: 10_000 },
	async (t) => {
		const setup = createBoundaryFixture(t);
		setup.ctx.mode = "tui";
		const widgets: unknown[] = [];
		setup.ctx.ui.setWidget = (_key, value) => {
			widgets.push(value);
		};
		await setup.start();
		const result = await setup.execute({
			action: "add",
			delay: "1s",
			scriptTask: {
				wakeUp: { kind: "on-error", prompt: "report failures" },
				scripts: [
					{ path: "./missing" },
					{
						path: process.execPath,
						params: ["-e", "process.stdout.write('second ran')"],
					},
				],
			},
		});
		assert.equal(result.details.ok, true);
		await until(() => setup.messages.length === 1);
		assert.equal(setup.messages[0]?.options?.triggerTurn, true);
		const run = setup.messages[0]?.details as TaskRun;
		assert.deepEqual(
			run.results.map((entry) => entry.status),
			["start-failed", "success"],
		);
		assert.match(run.content, /second ran/);
		assert.equal(run.successCount, 1);
		assert.ok(widgets.some((value) => typeof value === "function"));
		assert.equal(widgets.at(-1), undefined);
		assert.equal(
			(await setup.execute({ action: "list" })).details.active?.length,
			0,
		);
		const before = setup.entries.length;
		const rejected = await setup.execute({
			action: "add",
			delay: "1m",
			prompt: "duplicate",
			scriptTask: { wakeUp: { kind: "never" }, scripts: [{ path: "x" }] },
		});
		assert.equal(rejected.details.ok, false);
		assert.equal(setup.entries.length, before);
	},
);

test(
	"stop cancels future schedule but does not terminate the batch already started",
	{ timeout: 10_000 },
	async (t) => {
		const setup = createBoundaryFixture(t);
		await setup.start();
		await setup.execute({
			action: "add",
			interval: "1h",
			scriptTask: {
				wakeUp: { kind: "never" },
				scripts: [
					{
						path: process.execPath,
						params: [
							"-e",
							"setTimeout(() => process.stdout.write('finished after stop'), 80)",
						],
					},
				],
			},
		});
		const active = (await setup.execute({ action: "list" })).details
			.active?.[0];
		assert.ok(active?.kind === "session");
		await setup.run(`run ${active.task.definition.id}`);
		await setup.run(`stop ${active.task.definition.id}`);
		assert.equal(
			(await setup.execute({ action: "list" })).details.active?.length,
			0,
		);
		await until(() => setup.messages.length === 1);
		assert.match(String(setup.messages[0]?.content), /finished after stop/);
	},
);
