import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoulderSchedulerHarness } from "./boulder-scheduler-harness.js";

test("Boulder reporter contains a throwing hasUI getter and logger", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(console, "error", () => {
		throw new Error("logger failed");
	});
	const runtime = createBoulderSchedulerHarness("tui");
	Object.defineProperty(runtime.context, "hasUI", {
		get() {
			throw new Error("UI unavailable");
		},
	});
	await assert.doesNotReject(runtime.end());
	assert.equal(runtime.sent.length, 0);
});

test("repeated settled callbacks keep only one live Boulder wait and one attempt", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const runtime = createBoulderSchedulerHarness("print");
	await runtime.end();
	await runtime.settle();
	await runtime.settle();
	assert.equal(runtime.scheduleEntries.length, 1);
	t.mock.timers.tick(10_000);
	assert.deepEqual(
		runtime.sent.map((message) => message.details?.attempt),
		[1],
	);
	await runtime.settle();
	t.mock.timers.tick(10_000);
	assert.deepEqual(
		runtime.sent.map((message) => message.details?.attempt),
		[1, 2],
	);
});
