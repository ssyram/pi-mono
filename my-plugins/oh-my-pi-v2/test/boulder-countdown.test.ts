import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOULDER_SCHEDULE_ENTRY_TYPE } from "../hooks/boulder-schedule-entry.js";
import { createBoulderSchedulerHarness } from "./boulder-scheduler-harness.js";

describe("Boulder scheduled wait presentation", () => {
	it("records the schedule entry and refreshes the status countdown", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui", true);
		await harness.emit("session_start", { reason: "new" });
		await harness.end();

		assert.deepEqual(harness.scheduleEntries, [
			{
				customType: BOULDER_SCHEDULE_ENTRY_TYPE,
				data: { attempt: 1, maxAttempts: 10, scheduledDelayMs: 10_000 },
			},
		]);
		assert.equal(harness.statuses[0], "Boulder: resume attempt 1/10 in 10s (1 actionable tasks) — press Esc to cancel");
		testContext.mock.timers.tick(1_000);
		assert.equal(harness.statuses[1], "Boulder: resume attempt 1/10 in 9s (1 actionable tasks) — press Esc to cancel");
		assert.equal(harness.terminalInput("x"), undefined);
		testContext.mock.timers.tick(9_000);
		assert.equal(harness.sent.length, 1);
		assert.equal(harness.statuses.at(-1), undefined);
		testContext.mock.timers.reset();
	});

	it("cancels only when Escape is pressed", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui", true);
		await harness.emit("session_start", { reason: "new" });
		await harness.end();

		assert.deepEqual(harness.terminalInput("\u001b"), { consume: true });
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 0);
		assert.equal(harness.statuses.at(-1), undefined);
		assert.deepEqual(harness.notifications, ["Task restart cancelled."]);
		testContext.mock.timers.reset();
	});
});
