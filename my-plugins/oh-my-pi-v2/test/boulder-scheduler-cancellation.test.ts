import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOULDER_RESUME_MESSAGE_TYPE } from "../hooks/boulder-resume-message.js";
import { CONFIRM_STOP_TAG } from "../tools/task.js";
import { createBoulderSchedulerHarness } from "./boulder-scheduler-harness.js";

function customMessage(customType: string): object {
	return {
		message: {
			role: "custom",
			customType,
			content: "new information",
			display: true,
			details: {},
			timestamp: 0,
		},
	};
}

describe("Boulder scheduler cancellation", () => {
	for (const source of ["interactive", "rpc"] as const) {
		it(`cancels a wait for ${source} input and starts a fresh external episode`, async (testContext) => {
			testContext.mock.timers.enable({ apis: ["setTimeout"] });
			const harness = createBoulderSchedulerHarness("tui");
			await harness.emit("session_start", { reason: "new" });
			await harness.end();
			testContext.mock.timers.tick(10_000);
			await harness.end();

			await harness.emit("input", { source, text: "human update" });
			testContext.mock.timers.tick(10_000);
			assert.equal(harness.sent.length, 1);

			await harness.end();
			testContext.mock.timers.tick(10_000);
			assert.deepEqual(
				harness.sent.map((message) => message.details?.attempt),
				[1, 1],
			);
			testContext.mock.timers.reset();
		});
	}

	it("waits for a queued external follow-up to finish after an intermediate error", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });

		await harness.end();
		testContext.mock.timers.tick(10_000);
		await harness.emit("input", { source: "interactive", text: "queued human update" });
		harness.setPendingMessages(true);
		await harness.end("", "error");
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 1);

		harness.setPendingMessages(false);
		await harness.end("The queued human request has now completed normally.");
		testContext.mock.timers.tick(10_000);
		assert.deepEqual(
			harness.sent.map((message) => message.details?.attempt),
			[1, 1],
		);
		testContext.mock.timers.reset();
	});

	it("cancels for non-Boulder custom information but not a Boulder message", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });

		await harness.end();
		await harness.emit("message_start", customMessage("third-party-update"));
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 0);

		await harness.end();
		await harness.emit("message_start", customMessage(BOULDER_RESUME_MESSAGE_TYPE));
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 1);
		testContext.mock.timers.reset();
	});

	it("rejects a stale timer after actionable task state changes", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		await harness.end();
		harness.state.tasks[0] = { ...harness.state.tasks[0]!, updatedAt: 2 };

		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 0);
		await harness.end();
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent[0]?.details?.attempt, 1);
		testContext.mock.timers.reset();
	});

	it("preserves confirm-stop, abort, and question suppression", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const confirmed = createBoulderSchedulerHarness("tui");
		await confirmed.emit("session_start", { reason: "new" });
		await confirmed.end(`Cannot continue ${CONFIRM_STOP_TAG}`);
		const aborted = createBoulderSchedulerHarness("tui");
		await aborted.emit("session_start", { reason: "new" });
		await aborted.end("Interrupted response", "aborted");
		const questioning = createBoulderSchedulerHarness("tui");
		await questioning.emit("session_start", { reason: "new" });
		await questioning.end("Which option should I use?");

		testContext.mock.timers.tick(10_000);
		assert.equal(confirmed.sent.length, 0);
		assert.equal(aborted.sent.length, 0);
		assert.equal(questioning.sent.length, 0);
		testContext.mock.timers.reset();
	});

	it("rechecks compaction and background guards before dispatch", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const compacted = createBoulderSchedulerHarness("tui");
		await compacted.emit("session_start", { reason: "new" });
		await compacted.end();
		await compacted.emit("session_compact", {});
		testContext.mock.timers.tick(10_000);
		assert.equal(compacted.sent.length, 0);

		const background = createBoulderSchedulerHarness("tui");
		await background.emit("session_start", { reason: "new" });
		await background.end();
		background.setBackgroundRunning(true);
		testContext.mock.timers.tick(10_000);
		assert.equal(background.sent.length, 0);
		testContext.mock.timers.reset();
	});
});
