import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBoulderSchedulerHarness } from "./boulder-scheduler-harness.js";

function inhibitionEntry(type: string, value: boolean) {
	return { type: "custom", customType: "OMPv2InhibitBoulder", data: { type, value } };
}

describe("Boulder scheduler inhibition gate", () => {
	it("does not schedule when any inhibition source is active and reports the blockers", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		harness.setBranchEntries([inhibitionEntry("loop", true), inhibitionEntry("user", true)]);
		await harness.end();
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.scheduleEntries.length, 0);
		assert.equal(harness.sent.length, 0);
		assert.equal(harness.infoEntries.length, 1);
		assert.match(harness.infoEntries[0] ?? "", /^Boulder inhibited: user, loop$/);
		testContext.mock.timers.reset();
	});

	it("an inhibition signal written during the countdown cancels the dispatch", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		await harness.end();
		assert.equal(harness.scheduleEntries.length, 1);
		harness.setBranchEntries([inhibitionEntry("loop", true)]);
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 0);
		assert.ok((harness.infoEntries[harness.infoEntries.length - 1] ?? "").startsWith("Boulder inhibited: loop"));
		testContext.mock.timers.reset();
	});

	it("schedules again after the inhibition source closes", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		harness.setBranchEntries([inhibitionEntry("loop", true)]);
		await harness.end();
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.scheduleEntries.length, 0);

		harness.setBranchEntries([inhibitionEntry("loop", false)]);
		await harness.end();
		assert.equal(harness.scheduleEntries.length, 1);
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 1);
		testContext.mock.timers.reset();
	});

	it("prints the clear report for an empty branch but still schedules", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		await harness.end();
		assert.equal(harness.infoEntries.length, 1);
		assert.equal(harness.infoEntries[0], "Boulder inhibition clear");
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 1);
		testContext.mock.timers.reset();
	});
});
