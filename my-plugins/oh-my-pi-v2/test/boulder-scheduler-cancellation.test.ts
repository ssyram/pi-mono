import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOULDER_RESUME_MESSAGE_TYPE } from "../hooks/boulder-resume-message.js";
import { CONFIRM_STOP_TAG } from "../hooks/boulder-stop-protocol.js";
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

	it("re-reads actionable task state before dispatch", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		await harness.end();
		harness.state.tasks[0] = { ...harness.state.tasks[0]!, text: "fresh task", updatedAt: 2 };

		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 1);
		assert.match(harness.sent[0]?.content ?? "", /fresh task/);
		testContext.mock.timers.reset();
	});

	it("does not schedule an error retry that completes before the agent settles", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", content: [], stopReason: "error" }],
		});
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.scheduleEntries.length, 0);
		await harness.emit("agent_start", {});

		harness.state.tasks = [];
		harness.state.actionableCount = 0;
		harness.setIdle(true);
		await harness.settle();
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 0);
		testContext.mock.timers.reset();
	});

	it("drops a timer that reaches expiry while Pi is active", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		await harness.emit("agent_end", { messages: [] });
		await harness.settle();
		harness.setIdle(false);
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.sent.length, 0);
		testContext.mock.timers.reset();
	});

	it("suppresses only confirmed stops and user aborts", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const confirmed = createBoulderSchedulerHarness("tui");
		await confirmed.emit("session_start", { reason: "new" });
		await confirmed.end(`Cannot continue ${CONFIRM_STOP_TAG}。\n `);
		const aborted = createBoulderSchedulerHarness("tui");
		await aborted.emit("session_start", { reason: "new" });
		await aborted.end("Interrupted response", "aborted");
		const questioning = createBoulderSchedulerHarness("tui");
		await questioning.emit("session_start", { reason: "new" });
		await questioning.end("Which option should I use?");
		const quoted = createBoulderSchedulerHarness("tui");
		await quoted.emit("session_start", { reason: "new" });
		await quoted.end(`Cannot continue ${CONFIRM_STOP_TAG}”`);

		testContext.mock.timers.tick(10_000);
		assert.equal(confirmed.sent.length, 0);
		assert.equal(aborted.sent.length, 0);
		assert.equal(questioning.sent.length, 1);
		assert.equal(quoted.sent.length, 1);
		testContext.mock.timers.reset();
	});

	it("does not schedule while a same-session async subagent is active", async (testContext) => {
		testContext.mock.timers.enable({ apis: ["setTimeout"] });
		const harness = createBoulderSchedulerHarness("tui");
		await harness.emit("session_start", { reason: "new" });
		harness.backgroundStarted();
		await harness.end();
		testContext.mock.timers.tick(10_000);
		assert.equal(harness.scheduleEntries.length, 0);
		assert.equal(harness.sent.length, 0);

		harness.backgroundCompleted();
		await harness.end();
		assert.equal(harness.scheduleEntries.length, 1);
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
		background.backgroundStarted();
		testContext.mock.timers.tick(10_000);
		assert.equal(background.sent.length, 0);
		testContext.mock.timers.reset();
	});
});
