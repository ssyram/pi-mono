import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActiveTask } from "../src/v2/model.js";
import {
	collectLoopWidgetItems,
	formatQueuedSuffix,
	loopWidgetLines,
} from "../src/loop-widget-items.js";

function activeTask(
	id: string,
	nextRunAt: number,
	name?: string,
): ActiveTask {
	return {
		kind: "session",
		task: {
			definition: {
				id,
				scope: "session",
				prompt: "x",
				schedule: { kind: "interval", intervalMs: 60_000 },
				createdAt: 1,
				...(name !== undefined ? { name } : {}),
			},
			progress: { status: "active", nextRunAt, runCount: 0 },
		},
	};
}

test("queued counts annotate their own task and appear without an active schedule", () => {
	const items = collectLoopWidgetItems(
		[activeTask("recurring", 1000)],
		[],
		new Map([
			["recurring", { wakeUps: 1, noWakes: 2 }],
			["finished-once", { wakeUps: 0, noWakes: 1 }],
			["empty", { wakeUps: 0, noWakes: 0 }],
		]),
	);
	assert.deepEqual(
		items.map((item) => item.id),
		["finished-once", "recurring"],
	);
	assert.deepEqual(items[0]?.queued, { wakeUps: 0, noWakes: 1 });
	assert.deepEqual(items[0]?.pendingDelivery, { shouldWake: false });
	assert.deepEqual(items[1]?.queued, { wakeUps: 1, noWakes: 2 });
	assert.equal(items[1]?.pendingDelivery, undefined);
});

test("task lines carry the queued suffix with zero parts omitted", () => {
	const items = collectLoopWidgetItems(
		[activeTask("recurring", 10_000, "poller"), activeTask("quiet", 20_000)],
		[],
		new Map([
			["recurring", { wakeUps: 2, noWakes: 1 }],
			["quiet", { wakeUps: 0, noWakes: 0 }],
			["wakes-only", { wakeUps: 3, noWakes: 0 }],
			["no-wakes-only", { wakeUps: 0, noWakes: 4 }],
		]),
	);
	const lines = loopWidgetLines(items, 200, 0);
	assert.match(lines[0] ?? "", /^Pending delivery \(wake\) · wakes-only \(3 wake-up\)$/);
	assert.match(lines[1] ?? "", /^Pending delivery \(no wake\) · no-wakes-only \(4 no-wake\)$/);
	assert.match(lines[2] ?? "", /Waiting .* · recurring \(2 wake-up, 1 no-wake\)$/);
	assert.doesNotMatch(lines[3] ?? "", /wake-up|no-wake/);
});

test("formatQueuedSuffix omits zero components and returns empty when both zero", () => {
	assert.equal(formatQueuedSuffix(0, 0), "");
	assert.equal(formatQueuedSuffix(1, 0), " (1 wake-up)");
	assert.equal(formatQueuedSuffix(0, 2), " (2 no-wake)");
	assert.equal(formatQueuedSuffix(3, 4), " (3 wake-up, 4 no-wake)");
});
