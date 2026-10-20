import assert from "node:assert/strict";
import { test } from "node:test";
import scheduledWakeup from "../src/extension.js";
import { collectLoopWidgetItems } from "../src/loop-widget-items.js";
import {
	LOOP_WIDGET_VISIBILITY,
	readLoopWidgetVisibility,
} from "../src/loop-widget-visibility.js";
import type { ActiveTask } from "../src/v2/model.js";
import { parseLoopV2Command } from "../src/v2/parse-v2-command.js";
import { createBoundaryFixture } from "./outer-boundary-fixture.js";

function waiting(id: string): ActiveTask {
	return {
		kind: "session",
		task: {
			definition: {
				id,
				scope: "session",
				prompt: "x",
				schedule: { kind: "interval", intervalMs: 1000 },
				createdAt: 1000,
			},
			progress: { status: "active", nextRunAt: 5000, runCount: 0 },
		},
	};
}

test("scheduled and running items merge by id, retaining a running once item until it ends", () => {
	const running = {
		id: "recurring",
		wakeUpId: "run",
		success: 1,
		completed: 1,
		total: 2,
	};
	const rows = collectLoopWidgetItems(
		[waiting("recurring"), waiting("future")],
		[running, { ...running, id: "once" }],
	);
	assert.equal(rows.length, 3);
	assert.equal(rows.filter((row) => row.id === "recurring").length, 1);
	assert.equal(rows.filter((row) => row.running).length, 2);
	assert.equal(collectLoopWidgetItems([], []).length, 0);
});

test("visibility is session/branch-local, defaults on and ignores malformed records", () => {
	assert.equal(readLoopWidgetVisibility([]), true);
	assert.equal(
		readLoopWidgetVisibility([
			{
				type: "custom",
				customType: LOOP_WIDGET_VISIBILITY,
				data: { visible: false },
			},
		]),
		false,
	);
	assert.equal(
		readLoopWidgetVisibility([
			{
				type: "custom",
				customType: LOOP_WIDGET_VISIBILITY,
				data: { visible: "false" },
			},
		]),
		true,
	);
	assert.deepEqual(parseLoopV2Command("show off"), {
		kind: "show",
		visible: false,
	});
	assert.deepEqual(parseLoopV2Command("show on"), {
		kind: "show",
		visible: true,
	});
	assert.equal(parseLoopV2Command("show on --global").kind, "error");
});

test("show off/on changes only widget display and restores after reload", async (t) => {
	const setup = createBoundaryFixture(t);
	setup.ctx.mode = "tui";
	const calls: unknown[] = [];
	setup.ctx.ui.setWidget = (_key, value) => {
		calls.push(value);
	};
	await setup.start();
	assert.equal(calls.length, 0);
	await setup.run("add 1h waiting");
	assert.equal(typeof calls.at(-1), "function");
	const before = (await setup.execute({ action: "list" })).details.active;
	await setup.run("show off");
	assert.equal(calls.at(-1), undefined);
	assert.equal(readLoopWidgetVisibility(setup.entries), false);
	assert.deepEqual(
		(await setup.execute({ action: "list" })).details.active,
		before,
	);
	await setup.shutdown();
	scheduledWakeup(setup.pi);
	const count = calls.length;
	await setup.start();
	assert.equal(calls.length, count);
	await setup.run("show on");
	assert.equal(typeof calls.at(-1), "function");
	assert.equal(readLoopWidgetVisibility(setup.entries), true);
});

test("failed show save is reported without changing the display or tasks", async (t) => {
	const setup = createBoundaryFixture(t);
	await setup.start();
	setup.failures.append = true;
	await assert.doesNotReject(setup.run("show off"));
	assert.equal(readLoopWidgetVisibility(setup.entries), true);
	assert.match(setup.notifications.at(-1) ?? "", /Loop command failed/);
});
