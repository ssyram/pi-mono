import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { validateTaskStateEntryData } from "../tools/task-state-entry.js";
import { createHumanTaskCompletionProvider } from "../tools/task-system/human-completion.js";
import { taskCompletionInput } from "../tools/task-system/human-completion-input.js";
import { parseTaskState } from "../tools/task-system/state.js";
import { state, task } from "./task-system-fixtures.js";

const DATE_MAX = 8_640_000_000_000_000;

test("task restoration rejects out-of-Date-domain timestamps but accepts the exact upper bound", () => {
	for (const timestamp of [
		DATE_MAX + 1,
		Number.MAX_SAFE_INTEGER,
		1e100,
		Infinity,
	]) {
		const snapshot = state({
			...task(1),
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		assert.equal(validateTaskStateEntryData(snapshot), undefined);
		assert.equal(parseTaskState(snapshot), undefined);
	}
	const valid = parseTaskState(
		state({ ...task(1), createdAt: DATE_MAX, updatedAt: DATE_MAX }),
	);
	assert.ok(valid);
	assert.doesNotThrow(() => new Date(valid.tasks[0].createdAt).toISOString());
});

test("dangling dependency graphs never become restored task owner state", () => {
	assert.equal(
		parseTaskState({ tasks: [task(1, "in_progress", [99])], nextId: 2 }),
		undefined,
	);
});

const delegate: AutocompleteProvider = {
	async getSuggestions() {
		return null;
	},
	applyCompletion(lines, cursorLine, cursorCol) {
		return { lines, cursorLine, cursorCol };
	},
};

for (const marked of [
	String.raw`/task add work --blocked-by 1,ta|,foo\"bar --start`,
	String.raw`/task add work --blocked-by "1,ta|,foo\"bar" --start`,
	String.raw`/task add work --blocked-by '1,ta|,foo'\''bar' --start`,
]) {
	test(`dependency completion re-encodes retained literal quotes: ${marked}`, async () => {
		const cursor = marked.indexOf("|");
		const line = marked.replace("|", "");
		const provider = createHumanTaskCompletionProvider(delegate, () => [
			task(2),
		]);
		const choices = await provider.getSuggestions([line], 0, cursor, {
			signal: AbortSignal.timeout(10_000),
		});
		assert.ok(choices);
		assert.equal(choices.items.length, 1);
		const result = provider.applyCompletion(
			[line],
			0,
			cursor,
			choices.items[0],
			choices.prefix,
		);
		const parsed = taskCompletionInput(result.lines, 0, result.lines[0].length);
		assert.ok(parsed);
		assert.equal(parsed.tokens[3]?.value, choices.items[0].value);
		assert.equal(parsed.tokens[3]?.complete, true);
		assert.equal(parsed.tokens[4]?.value, "--start");
		assert.equal(parsed.tokens[4]?.literal, false);
	});
}
