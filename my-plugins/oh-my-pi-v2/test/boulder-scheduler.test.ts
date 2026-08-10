import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBoulderSchedulerHarness } from "./boulder-scheduler-harness.js";

const NORMAL_DELAYS = [10_000, 10_000, 10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 640_000, 1_280_000];

describe("Boulder scheduler episodes", () => {
	it("dispatches exactly three print attempts at ten-second intervals", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("print");
		await harness.emit("session_start", { reason: "new" });

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			await harness.end();
			testContext.mock.timers.tick(10_000);
			assert.equal(harness.sent.at(-1)?.details?.attempt, attempt);
			assert.equal(harness.sent.at(-1)?.details?.maxAttempts, 3);
			assert.equal(harness.sent.at(-1)?.details?.scheduledDelayMs, 10_000);
		}
		await harness.end();
		testContext.mock.timers.tick(3_600_000);
		assert.equal(harness.sent.length, 3);
		assert.ok(harness.taskReadContexts.length > 0);
		assert.ok(harness.taskReadContexts.every((context) => context === harness.context));
		testContext.mock.timers.reset();
	});

	it("dispatches the exact ten-attempt normal sequence and then stops", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });

		for (const [index, delay] of NORMAL_DELAYS.entries()) {
			await harness.end();
			testContext.mock.timers.tick(delay);
			assert.equal(harness.sent.at(-1)?.details?.attempt, index + 1);
			assert.equal(harness.sent.at(-1)?.details?.maxAttempts, 10);
			assert.equal(harness.sent.at(-1)?.details?.scheduledDelayMs, delay);
		}
		await harness.end();
		testContext.mock.timers.tick(3_600_000);
		assert.equal(harness.sent.length, 10);
		testContext.mock.timers.reset();
	});

	it("does not re-arm an active wait on a duplicate agent end", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });

		await harness.end();
		testContext.mock.timers.tick(5_000);
		await harness.end();
		testContext.mock.timers.tick(5_000);

		assert.equal(harness.sent.length, 1);
		assert.equal(harness.sent[0]?.details?.attempt, 1);
		testContext.mock.timers.reset();
	});

	it("consumes a dispatch attempt even when sendMessage throws", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		harness.failNextDispatch();

		await harness.end();
		testContext.mock.timers.tick(10_000);
		await harness.end();
		testContext.mock.timers.tick(10_000);

		assert.deepEqual(
			harness.sent.map((message) => message.details?.attempt),
			[1, 2],
		);
		testContext.mock.timers.reset();
	});

	it("resets the budget after material task progress", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });

		await harness.end();
		testContext.mock.timers.tick(10_000);
		harness.state.tasks[0] = { ...harness.state.tasks[0]!, updatedAt: 2 };
		await harness.end();
		testContext.mock.timers.tick(10_000);

		assert.deepEqual(
			harness.sent.map((message) => message.details?.attempt),
			[1, 1],
		);
		testContext.mock.timers.reset();
	});
});
