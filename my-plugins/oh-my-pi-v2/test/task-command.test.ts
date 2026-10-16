import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
	parseTaskCommand,
	registerTaskCommand,
	TASK_HELP_TEXT,
} from "../commands/task.js";
import {
	completeTaskArgument,
	createTaskCompletionProvider,
} from "../commands/task-completion.js";
import {
	formatTaskInfo,
	TASK_INFO_ENTRY_TYPE,
} from "../tools/task-info-entry.js";
import type { Task } from "../tools/task-types.js";

const timestamp = Date.parse("2026-01-01T00:00:00.000Z");

function task(id: number, text = `task ${id}`): Task {
	return {
		id,
		text,
		status: "pending",
		blocks: [],
		blockedBy: [],
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function fallbackProvider(): AutocompleteProvider {
	return {
		async getSuggestions() {
			return null;
		},
		applyCompletion(lines, cursorLine, cursorCol) {
			return { lines, cursorLine, cursorCol };
		},
	};
}

describe("task command", () => {
	it("parses the documented grammar and rejects incomplete commands", () => {
		assert.deepEqual(parseTaskCommand(""), { action: "help" });
		assert.deepEqual(parseTaskCommand("help"), { action: "help" });
		assert.deepEqual(parseTaskCommand("info"), { action: "info" });
		assert.deepEqual(parseTaskCommand("show on"), {
			action: "show",
			visible: true,
			targets: {},
		});
		assert.deepEqual(parseTaskCommand("SHOW OFF"), {
			action: "show",
			visible: false,
			targets: {},
		});
		assert.deepEqual(parseTaskCommand("show"), {
			action: "invalid",
			input: "show",
		});
		assert.deepEqual(parseTaskCommand("off"), {
			action: "invalid",
			input: "off",
		});
	});

	it("persists visibility and emits only custom entries", async () => {
		const entries: Array<{ customType: string; data: unknown }> = [];
		let handler:
			| Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]
			| undefined;
		const pi = {
			registerEntryRenderer: () => undefined,
			registerCommand: (
				_name: string,
				options: Parameters<ExtensionAPI["registerCommand"]>[1],
			) => {
				handler = options.handler;
			},
			appendEntry: (customType: string, data: unknown) =>
				entries.push({ customType, data }),
			on: () => undefined,
		} as unknown as ExtensionAPI;
		const visibility: boolean[] = [];
		const taskReadContexts: ExtensionCommandContext[] = [];
		const saves: unknown[] = [];
		registerTaskCommand(pi, {
			updateSetting: async (_ctx, key, value, targets) => {
				saves.push({ key, value, targets });
				return { ok: true, applied: true, message: "saved" };
			},
			getTasks: (context) => {
				taskReadContexts.push(context);
				return [task(1, "full\ntext")];
			},
			setWidgetVisibility: (_ctx, visible) => {
				visibility.push(visible);
			},
			runHumanTaskCommand: () => {
				throw new Error(
					"human command routing is covered by task-system-integration tests",
				);
			},
		});
		if (!handler) throw new Error("task command was not registered");
		const context = {} as ExtensionCommandContext;

		await handler("show off", context);
		await handler("show on", context);
		assert.deepEqual(visibility, [false, true]);
		assert.deepEqual(saves, [
			{ key: "omp-task:show", value: false, targets: {} },
			{ key: "omp-task:show", value: true, targets: {} },
		]);
		assert.ok(
			entries.every((entry) => entry.customType === TASK_INFO_ENTRY_TYPE),
		);
		const statesBeforeInvalid = saves.length;
		const beforeInvalid = entries.length;
		await handler("show", context);
		assert.equal(entries.length, beforeInvalid + 1);
		assert.equal(entries.at(-1)?.customType, TASK_INFO_ENTRY_TYPE);
		assert.equal(saves.length, statesBeforeInvalid);
		assert.match(
			String((entries.at(-1)?.data as { text?: string }).text),
			/Unknown or incomplete/,
		);

		await handler("", context);
		assert.equal(
			(entries.at(-1)?.data as { text?: string }).text,
			TASK_HELP_TEXT,
		);
		await handler("info", context);
		assert.match(
			String((entries.at(-1)?.data as { text?: string }).text),
			/full\ntext/,
		);
		assert.deepEqual(taskReadContexts, [context]);
	});

	it("prints every task field without truncating text", () => {
		const first = task(1, "line one\nline two");
		first.status = "expired";
		first.blocks = [2];
		first.expireReason = "complete reason";
		const output = formatTaskInfo([first, task(2)]);

		assert.match(output, /line one\nline two/);
		assert.match(output, /blocks: #2/);
		assert.match(output, /expireReason: complete reason/);
		assert.match(output, /createdAt: .* \(1767225600000\)/);
		assert.match(output, /#2 \[pending\]/);
	});
});

describe("task command completion", () => {
	it("offers hierarchical candidates", () => {
		assert.deepEqual(
			completeTaskArgument([])?.map((candidate) => candidate.value),
			["show", "info", "help", "no-task-no-tool"],
		);
		assert.deepEqual(
			completeTaskArgument(["show"])?.map((candidate) => candidate.value),
			["on", "off"],
		);
		assert.equal(completeTaskArgument(["info"]), null);
	});

	it("fuzzy-completes the active token and preserves trailing text", async () => {
		const provider = createTaskCompletionProvider(fallbackProvider());
		const suggestions = await provider.getSuggestions(["/task so tail"], 0, 8, {
			signal: new AbortController().signal,
		});
		assert.deepEqual(
			suggestions?.items.map((item) => item.value),
			["show", "no-task-no-tool"],
		);
		const showSuggestions = await provider.getSuggestions(
			["/task show o"],
			0,
			12,
			{
				signal: new AbortController().signal,
			},
		);
		assert.deepEqual(
			showSuggestions?.items.map((item) => item.value),
			["on", "off"],
		);
		const completed = provider.applyCompletion(
			["/task so tail"],
			0,
			8,
			suggestions?.items[0] ?? { value: "show", label: "show" },
			"so",
		);
		assert.equal(completed.lines[0], "/task show  tail");
		assert.equal(
			provider.shouldTriggerFileCompletion?.(["/task "], 0, 6),
			true,
		);
	});
});
