import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { DuePoller } from "../src/v2/due-poller.js";
import { createLoopCommandAutocompleteProvider } from "../src/v2/loop-command-autocomplete.js";
import type { LoopV2Core } from "../src/v2/loop-core.js";

const source = { taskLabels: () => [], definitionLabels: () => [] };
const choice = { label: "x", value: "x" };
const delegate: AutocompleteProvider & {
	shouldTriggerFileCompletion(lines: string[]): boolean;
} = {
	async getSuggestions(lines) {
		lines[0] = "corrupted";
		throw new Error("delegate rejected");
	},
	applyCompletion(lines) {
		lines[0] = "corrupted";
		throw new Error("delegate failed");
	},
	shouldTriggerFileCompletion(lines) {
		lines[0] = "corrupted";
		throw new Error("delegate failed");
	},
};

for (const original of ["plain", "/loop unknown ", "/loop stop "]) {
	test(`loop delegated suggestions preserve editor input: ${original}`, async () => {
		const lines = [original];
		const provider = createLoopCommandAutocompleteProvider(delegate, source);
		assert.equal(
			await provider.getSuggestions(lines, 0, original.length, {
				signal: AbortSignal.timeout(10_000),
			}),
			null,
		);
		assert.deepEqual(lines, [original]);
	});
}

test("loop delegated application and trigger preserve editor input after mutation then throw", () => {
	const lines = ["plain"];
	const provider = createLoopCommandAutocompleteProvider(delegate, source);
	assert.deepEqual(provider.applyCompletion(lines, 0, 5, choice, ""), {
		lines: ["plain"],
		cursorLine: 0,
		cursorCol: 5,
	});
	assert.equal(provider.shouldTriggerFileCompletion?.(lines, 0, 5), false);
	assert.deepEqual(lines, ["plain"]);
});

test("reschedule failure states that polling stopped and retains the underlying cause", () => {
	const failure = new Error("catalog unreadable");
	let fail = false;
	let reads = 0;
	const core = {
		listActive() {
			reads++;
			if (fail) throw failure;
			return [];
		},
	} as unknown as LoopV2Core;
	const poller = new DuePoller({ core, deliver: () => undefined });
	poller.start();
	assert.equal(poller.isRunning, true);
	fail = true;
	const failed = poller.reschedule();
	assert.equal(failed.ok, false);
	assert.ok(!failed.ok);
	assert.match(failed.message, /due polling stopped/);
	assert.equal(failed.cause, failure);
	assert.equal(poller.isRunning, false);
	const stoppedReads = reads;
	assert.equal(poller.reschedule().ok, false);
	assert.equal(reads, stoppedReads);
	poller.dispose();
});
