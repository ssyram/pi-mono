import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	type AutocompleteFactory,
	createSetup,
	PRELOAD_NOW,
	pushRegistration,
	pushSessionTask,
} from "./extension-fixture.js";

const RUNNER_ENV = "PI_SCHEDULED_WAKEUP_RUNNER";

describe("scheduledWakeup v2 extension lifecycle", () => {
	afterEach(() => {
		delete process.env[RUNNER_ENV];
	});

	it("does not start the poller in print mode but keeps commands working", async () => {
		const setup = createSetup({ mode: "print" });
		pushSessionTask(setup.branch, "first", {
			kind: "once",
			runAt: PRELOAD_NOW,
		});
		await setup.start();

		await wait(80);
		assert.deepEqual(setup.sent, []);

		await setup.runLoop("add 1h hello from print");
		const snapshots = setup.appendedSnapshots();
		assert.equal(snapshots.length, 2);
		assert.equal(snapshots.at(-1)?.tasks.length, 2);
		assert.equal(snapshots.at(-1)?.tasks[0]?.progress.status, "expired");
		assert.equal(
			snapshots.at(-1)?.tasks[1]?.definition.prompt,
			"hello from print",
		);
		assert.deepEqual(snapshots.at(-1)?.tasks[1]?.definition.schedule, {
			kind: "interval",
			intervalMs: 3_600_000,
		});
		assert.ok(snapshots.at(-1)?.tasks[1]?.definition.id.startsWith("session:"));
	});

	it("starts the runner poller but expires old one-shots before delivery", async () => {
		process.env[RUNNER_ENV] = "1";
		const setup = createSetup({ mode: "json" });
		pushSessionTask(setup.branch, "overdue", {
			kind: "once",
			runAt: PRELOAD_NOW,
		});
		pushSessionTask(setup.branch, "on time", {
			kind: "once",
			runAt: Date.now() + 200,
		});
		await setup.start();

		await wait(300);
		assert.equal(
			setup.appendedSnapshots()[0]?.tasks[0]?.progress.status,
			"expired",
		);
		assert.deepEqual(
			setup.sent.map((message) => message.content),
			["on time"],
		);
		assert.equal(setup.sent[0]?.options?.deliverAs, "followUp");
	});

	it("delivers in tui mode and clears pending timers on session_shutdown", async () => {
		const setup = createSetup({ mode: "tui" });
		pushSessionTask(setup.branch, "first", {
			kind: "once",
			runAt: Date.now() + 200,
		});
		pushSessionTask(setup.branch, "future", {
			kind: "once",
			runAt: Date.now() + 800,
		});
		await setup.start();

		await wait(300);
		assert.deepEqual(
			setup.sent.map((message) => message.content),
			["first"],
		);
		assert.equal(setup.notifications.at(-1), "Scheduled wakeup loaded");

		pushSessionTask(setup.branch, "third", {
			kind: "once",
			runAt: PRELOAD_NOW,
		});
		await setup.shutdown();
		await wait(700);
		assert.deepEqual(
			setup.sent.map((message) => message.content),
			["first"],
		);
	});

	it("reconciles stale registrations and wires autocomplete to live core ids", async () => {
		const setup = createSetup({ mode: "tui" });
		pushRegistration(
			setup.branch,
			"registration:workspace:missing",
			"workspace:missing",
		);
		await setup.start();

		const snapshots = setup.appendedSnapshots();
		assert.equal(snapshots.length, 1);
		assert.deepEqual(snapshots[0]?.registrations, []);
		assert.equal(setup.autocompleteFactories.length, 1);

		await setup.runLoop("add 1h autocomplete probe");
		const factory = setup.autocompleteFactories[0];
		assert.ok(factory);
		const values = await suggest(factory, "/loop stop ");
		assert.equal(
			values.some((value) => value.startsWith("session:")),
			true,
		);
	});
});

async function suggest(
	factory: AutocompleteFactory,
	line: string,
): Promise<string[]> {
	const provider = factory({
		getSuggestions: async () => null,
		applyCompletion: () => ({
			lines: [] as string[],
			cursorLine: 0,
			cursorCol: 0,
		}),
	});
	const result = await provider.getSuggestions([line], 0, line.length, {
		signal: new AbortController().signal,
		force: true,
	});
	return result?.items.map((item) => item.value) ?? [];
}

async function wait(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}
