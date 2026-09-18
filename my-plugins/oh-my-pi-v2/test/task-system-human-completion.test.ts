import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { TaskAutocompleteProvider } from "../commands/task-completion.js";
import { parseHumanTaskCommand } from "../tools/task-system/human-command.js";
import { createHumanTaskCompletionProvider } from "../tools/task-system/human-completion.js";
import type { TaskRecord } from "../tools/task-system/model.js";
import { task } from "./task-system-fixtures.js";

const options = { signal: new AbortController().signal, force: true };
function position(marked: string) {
	const cursor = marked.indexOf("|");
	assert.notEqual(cursor, -1);
	const text = marked.slice(0, cursor) + marked.slice(cursor + 1);
	const before = text.slice(0, cursor).split("\n");
	return {
		lines: text.split("\n"),
		cursorLine: before.length - 1,
		cursorCol: before.at(-1)?.length ?? 0,
	};
}
function harness(
	readTasks: () => readonly TaskRecord[] = () => [
		task(1),
		task(12, "done"),
		task(123, "expired"),
		task(3),
	],
) {
	const calls: string[] = [];
	const fallback: TaskAutocompleteProvider = {
		async getSuggestions(_lines, _line, _col, received) {
			calls.push("get");
			assert.equal(received, options);
			return {
				prefix: "fallback",
				items: [{ value: "fallback", label: "fallback" }],
			};
		},
		applyCompletion(lines, cursorLine, cursorCol) {
			calls.push("apply");
			return { lines, cursorLine, cursorCol };
		},
		shouldTriggerFileCompletion() {
			calls.push("trigger");
			return false;
		},
	};
	return {
		provider: createHumanTaskCompletionProvider(fallback, readTasks),
		calls,
	};
}
async function suggestions(provider: AutocompleteProvider, marked: string) {
	const at = position(marked);
	return provider.getSuggestions(
		at.lines,
		at.cursorLine,
		at.cursorCol,
		options,
	);
}
async function values(provider: AutocompleteProvider, marked: string) {
	return (
		(await suggestions(provider, marked))?.items.map((item) => item.value) ?? []
	);
}
async function complete(
	provider: AutocompleteProvider,
	marked: string,
	value: string,
) {
	const at = position(marked);
	const found = await suggestions(provider, marked);
	assert.ok(found);
	const item = found.items.find((entry) => entry.value === value);
	assert.ok(item, `${value} missing for ${marked}`);
	return provider.applyCompletion(
		at.lines,
		at.cursorLine,
		at.cursorCol,
		item,
		found.prefix,
	);
}
function parse(lines: string[]) {
	return parseHumanTaskCommand(lines.join("\n").replace(/^\s*\/task\s+/, ""));
}

describe("dormant human task autocomplete", () => {
	it("includes new and legacy roots, preserving loose legacy matching", async () => {
		const { provider } = harness();
		assert.deepEqual(await values(provider, "/task |"), [
			"show",
			"info",
			"help",
			"add",
			"modify",
			"list",
			"clear",
		]);
		assert.deepEqual(await values(provider, "/task md|"), ["modify"]);
		assert.deepEqual(await values(provider, "/task SHOW o|"), ["on", "off"]);
		assert.deepEqual(await values(provider, "/task sh|"), ["show"]);
		assert.equal(
			(await suggestions(provider, "/task sh|"))?.items[0].description,
			"Control task widget visibility",
		);
		assert.equal(
			(await suggestions(provider, "/task show of|"))?.items[0].description,
			"Hide the task widget",
		);
	});
	it("offers exactly applicable unused flags, including later flags", async () => {
		const { provider } = harness();
		assert.deepEqual(await values(provider, '/task add "work item" |'), [
			"--start",
			"--blocked-by",
		]);
		assert.deepEqual(await values(provider, "/task add work --start --|"), [
			"--blocked-by",
		]);
		assert.deepEqual(await values(provider, "/task modify 1 |"), [
			"--text",
			"--blocked-by",
			"--status",
			"--reason",
		]);
		assert.deepEqual(
			await values(provider, "/task modify 1 --| --status done"),
			["--text", "--blocked-by", "--reason"],
		);
		assert.deepEqual(await values(provider, "/task list |"), [
			"--type",
			"--limit",
		]);
		assert.deepEqual(
			await values(provider, "/task list --type open --limit 2 |"),
			[],
		);
		assert.deepEqual(await values(provider, "/task clear |"), []);
	});
	it("does not count quoted or escaped flag-looking text values as options", async () => {
		const { provider } = harness();
		for (const text of [
			'"--start"',
			"'--start'",
			"\\--start",
			"alpha\\ beta",
		]) {
			assert.deepEqual(await values(provider, `/task add ${text} --|`), [
				"--start",
				"--blocked-by",
			]);
		}
		assert.deepEqual(
			await values(provider, '/task modify 1 --text "--status" --|'),
			["--blocked-by", "--status", "--reason"],
		);
		assert.deepEqual(
			await values(
				provider,
				"/task modify 1 --reason '--text' --status expired --|",
			),
			["--text", "--blocked-by"],
		);
	});
	it("offers all status/type values and no invented numeric limits", async () => {
		const { provider } = harness();
		assert.deepEqual(await values(provider, "/task modify 1 --status |"), [
			"in_progress",
			"done",
			"expired",
		]);
		assert.deepEqual(await values(provider, "/task list --type |"), [
			"open",
			"closed",
			"in_progress",
			"ready",
			"blocked",
			"done",
			"expired",
		]);
		assert.deepEqual(await values(provider, "/task list --type CL|"), [
			"closed",
		]);
		assert.deepEqual(
			await values(provider, "/task list --type open --limit |"),
			["fallback"],
		);
	});
	it("suggests current numeric IDs including terminal tasks", async () => {
		const { provider } = harness();
		assert.deepEqual(await values(provider, "/task modify 1|"), [
			"1",
			"12",
			"123",
		]);
		const result = await suggestions(
			provider,
			"/task add work --blocked-by 12|",
		);
		assert.equal(result?.items[0].description, "[done] task 12");
		assert.equal(result?.items[1].description, "[expired] task 123");
		assert.deepEqual(await values(provider, "/task modify 01|"), []);
	});
	it("matches task text case-insensitively while inserting numeric IDs", async () => {
		const { provider } = harness(() => [
			{ ...task(7), text: "写文档 live 验证" },
			{ ...task(9, "done"), text: "ENGLISH ONLY" },
		]);
		assert.deepEqual(await values(provider, "/task modify 文档|"), ["7"]);
		assert.deepEqual(await values(provider, "/task modify english|"), ["9"]);
		assert.deepEqual(await values(provider, "/task modify ENGLISH|"), ["9"]);
		assert.deepEqual(await values(provider, "/task modify live|"), ["7"]);
		assert.deepEqual(await values(provider, "/task modify nope|"), []);
		const result = await complete(provider, "/task modify 文档|", "7");
		assert.equal(result.lines[0], "/task modify 7 ");
	});
	it("never suggests the clear confirmation flag", async () => {
		const { provider } = harness();
		for (const marked of [
			"/task clear |",
			"/task clear --|",
			"/task clear --C|",
		]) {
			const offered = (await suggestions(provider, marked))?.items ?? [];
			assert.ok(
				!offered.some((item) => item.value.includes("CONFIRMED")),
				`${marked} must not offer --CONFIRMED`,
			);
		}
	});
	it("preserves comma neighbors and excludes duplicates/self IDs", async () => {
		const { provider } = harness();
		assert.deepEqual(
			await values(provider, "/task modify 1 --blocked-by 12,|"),
			["12,123", "12,3"],
		);
		assert.deepEqual(
			await values(provider, "/task modify 1 --blocked-by |,3"),
			["12,3", "123,3"],
		);
		const result = await complete(
			provider,
			"/task modify 1 --blocked-by 12,1|99,3 --text good",
			"12,123,3",
		);
		assert.equal(
			result.lines[0],
			"/task modify 1 --blocked-by 12,123,3 --text good",
		);
		assert.deepEqual(parse(result.lines), {
			action: "modify",
			id: 1,
			blockedBy: [12, 123, 3],
			text: "good",
		});
	});
	it("replaces entire tokens in the middle without duplicating suffixes", async () => {
		const { provider } = harness();
		const root = await complete(
			provider,
			"/task mo|dify 1 --text good",
			"modify",
		);
		assert.equal(root.lines[0], "/task modify 1 --text good");
		assert.equal(root.cursorCol, "/task modify ".length);
		const flag = await complete(
			provider,
			"/task modify 1 --st|atus done --text good",
			"--status",
		);
		assert.equal(flag.lines[0], "/task modify 1 --status done --text good");
		assert.equal(parse(flag.lines).action, "modify");
		const id = await complete(provider, "/task modify 1|99 --text good", "12");
		assert.equal(id.lines[0], "/task modify 12 --text good");
	});
	it("preserves quotes and closes incomplete owned value quotes", async () => {
		const { provider } = harness();
		for (const quote of ['"', "'"]) {
			const result = await complete(
				provider,
				`/task list --type ${quote}cl|osed${quote} --limit 10`,
				"closed",
			);
			assert.equal(
				result.lines[0],
				`/task list --type ${quote}closed${quote} --limit 10`,
			);
			assert.deepEqual(parse(result.lines), {
				action: "list",
				type: "closed",
				limit: 10,
			});
			const unfinished = await complete(
				provider,
				`/task modify 1 --status ${quote}in_p|`,
				"in_progress",
			);
			assert.equal(
				unfinished.lines[0],
				`/task modify 1 --status ${quote}in_progress${quote} `,
			);
			assert.deepEqual(parse(unfinished.lines), {
				action: "modify",
				id: 1,
				status: "in_progress",
			});
		}
	});
	it("normalizes adjacent quoted/escaped pieces without changing meaning", async () => {
		const { provider } = harness();
		for (const marked of [
			'/task list --type cl"o|sed"',
			"/task list --type cl\\o|sed",
			'/task list --type "cl"o|sed',
		]) {
			const result = await complete(provider, marked, "closed");
			assert.deepEqual(parse(result.lines), { action: "list", type: "closed" });
		}
		const escapedEnd = await complete(
			provider,
			"/task list --type cl\\|",
			"closed",
		);
		assert.deepEqual(parse(escapedEnd.lines), {
			action: "list",
			type: "closed",
		});
		const result = await complete(
			provider,
			'/task modify 1 --blocked-by "12,1|99,3" --text "原文 😀"',
			"12,123,3",
		);
		assert.equal(
			result.lines[0],
			'/task modify 1 --blocked-by "12,123,3" --text "原文 😀"',
		);
	});
	it("delegates free text, unfinished text quotes, bad prior input and unrelated syntax", async () => {
		const { provider, calls } = harness();
		for (const marked of [
			"/other |",
			"/taskish |",
			"/task|",
			"/task add |",
			'/task add "--st|',
			"/task modify 1 --text '--status |",
			"/task modify 1 --reason why|",
			'/task modify 1 "--st|',
			"/task modify 1 --unknown x |",
			"hello\n/task list --type |",
		])
			assert.deepEqual(await values(provider, marked), ["fallback"], marked);
		assert.equal(calls.length, 10);
	});
	it("delegates application and Tab trigger outside owned contexts", () => {
		const { provider, calls } = harness();
		const at = position('/task add "hello |');
		assert.equal(
			provider.shouldTriggerFileCompletion(
				at.lines,
				at.cursorLine,
				at.cursorCol,
			),
			false,
		);
		provider.applyCompletion(
			at.lines,
			at.cursorLine,
			at.cursorCol,
			{ value: "fallback", label: "fallback" },
			"fallback",
		);
		assert.deepEqual(calls, ["trigger", "apply"]);
		const own = position("/task list --type |");
		assert.equal(
			provider.shouldTriggerFileCompletion(
				own.lines,
				own.cursorLine,
				own.cursorCol,
			),
			true,
		);
	});
	it("reads fresh state for suggestions and application and never inserts stale IDs", async () => {
		let tasks = [task(1)];
		let reads = 0;
		const { provider, calls } = harness(() => {
			reads++;
			return tasks;
		});
		const marked = "/task modify |";
		const found = await suggestions(provider, marked);
		assert.ok(found);
		tasks = [task(2)];
		const at = position(marked);
		const stale = provider.applyCompletion(
			at.lines,
			at.cursorLine,
			at.cursorCol,
			found.items[0],
			found.prefix,
		);
		assert.deepEqual(stale, at);
		assert.deepEqual(await values(provider, marked), ["2"]);
		assert.equal(reads, 3);
		assert.deepEqual(calls, []);
	});
	it("isolates readers and leaves frozen task state and editor input untouched", async () => {
		const tasks = [task(1), task(12, "done")];
		for (const item of tasks) {
			Object.freeze(item.blocks);
			Object.freeze(item.blockedBy);
			Object.freeze(item);
		}
		Object.freeze(tasks);
		const snapshot = JSON.stringify(tasks);
		const first = harness(() => tasks).provider;
		const second = harness(() => [task(7)]).provider;
		assert.deepEqual(await values(first, "/task modify |"), ["1", "12"]);
		assert.deepEqual(await values(second, "/task modify |"), ["7"]);
		await complete(first, "/task modify 1 --blocked-by |", "12");
		assert.equal(JSON.stringify(tasks), snapshot);
		const at = position("/task list --type op|");
		Object.freeze(at.lines);
		const result = first.applyCompletion(
			at.lines,
			at.cursorLine,
			at.cursorCol,
			{ value: "open", label: "open" },
			"op",
		);
		assert.notEqual(result.lines, at.lines);
		assert.equal(at.lines[0], "/task list --type op");
	});
	it("contains reader faults as no completion without retrying the reader", async () => {
		const fault = new Error("state read failed");
		const { provider } = harness(() => {
			throw fault;
		});
		assert.equal(await suggestions(provider, "/task modify |"), null);
		const at = position("/task modify |");
		assert.deepEqual(
			provider.applyCompletion(
				at.lines,
				at.cursorLine,
				at.cursorCol,
				{ value: "1", label: "1" },
				"",
			),
			at,
		);
	});
	it("preserves multiline quoted text and suffix lines with correct cursor coordinates", async () => {
		const { provider } = harness();
		const result = await complete(
			provider,
			'/task add "alpha\nbeta 😀"\n--st|art\n--blocked-by 12',
			"--start",
		);
		assert.deepEqual(result.lines, [
			'/task add "alpha',
			'beta 😀"',
			"--start",
			"--blocked-by 12",
		]);
		assert.equal(result.cursorLine, 3);
		assert.equal(result.cursorCol, 0);
		assert.deepEqual(parse(result.lines), {
			action: "add",
			text: "alpha\nbeta 😀",
			start: true,
			blockedBy: [12],
		});
	});
	it("honors cancellation and rejects stale prefixes without inserting", async () => {
		const { provider } = harness();
		const at = position("/task list --type op|");
		const controller = new AbortController();
		controller.abort();
		assert.equal(
			await provider.getSuggestions(at.lines, at.cursorLine, at.cursorCol, {
				signal: controller.signal,
			}),
			null,
		);
		assert.deepEqual(
			provider.applyCompletion(
				at.lines,
				at.cursorLine,
				at.cursorCol,
				{ value: "open", label: "open" },
				"old",
			),
			at,
		);
	});
});
