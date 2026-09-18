import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHumanTaskCommand } from "../tools/task-system/human-command.js";
import { executeHumanTaskCommand } from "../tools/task-system/human-execute.js";
import { state, task } from "./task-system-fixtures.js";

describe("dormant human command grammar", () => {
	it("parses every approved example", () => {
		const examples = [
			[
				'add "调查问题" --start',
				{ action: "add", text: "调查问题", start: true },
			],
			[
				'add "实现修改" --blocked-by 12',
				{ action: "add", text: "实现修改", blockedBy: [12] },
			],
			[
				'modify 13 --text "实现并测试"',
				{ action: "modify", id: 13, text: "实现并测试" },
			],
			[
				"modify 13 --blocked-by 12,14",
				{ action: "modify", id: 13, blockedBy: [12, 14] },
			],
			["modify 13 --status done", { action: "modify", id: 13, status: "done" }],
			["list", { action: "list" }],
			[
				"list --type blocked --limit 10",
				{ action: "list", type: "blocked", limit: 10 },
			],
			["clear --CONFIRMED", { action: "clear" }],
		] as const;
		for (const [input, expected] of examples)
			assert.deepEqual(parseHumanTaskCommand(input), expected);
	});
	it("preserves Unicode, whitespace, literal single quotes and explicit escapes", () => {
		for (const [input, expected] of [
			['add "  文本 😀 with space  "', "  文本 😀 with space  "],
			[
				String.raw`add 'C:\new\file $HOME $(command)'`,
				String.raw`C:\new\file $HOME $(command)`,
			],
			[String.raw`add "say \"hello\" \\ path"`, 'say "hello" \\ path'],
			[String.raw`add escaped\ space`, "escaped space"],
			[String.raw`add "\n"`, "n"],
			['add ab"cd ef"gh', "abcd efgh"],
			['add "--start"', "--start"],
			[String.raw`add \--start`, "--start"],
			['modify 1 --text "--status"', "--status"],
		]) {
			const parsed = parseHumanTaskCommand(input);
			assert.ok("text" in parsed);
			assert.equal(parsed.text, expected);
		}
	});
	it("accepts empty dependency replacement, flag order, zero limit and expiry reason", () => {
		assert.deepEqual(parseHumanTaskCommand('modify 1 --blocked-by ""'), {
			action: "modify",
			id: 1,
			blockedBy: [],
		});
		assert.deepEqual(
			parseHumanTaskCommand('add work --blocked-by "" --start'),
			{
				action: "add",
				text: "work",
				blockedBy: [],
				start: true,
			},
		);
		assert.deepEqual(parseHumanTaskCommand("list --limit 0 --type done"), {
			action: "list",
			type: "done",
			limit: 0,
		});
		assert.deepEqual(
			parseHumanTaskCommand(
				"modify 1 --reason 'no longer needed' --status expired",
			),
			{
				action: "modify",
				id: 1,
				status: "expired",
				reason: "no longer needed",
			},
		);
	});
	it("rejects malformed grammar completely without changing any state", () => {
		const previous = state(task(1), task(2));
		const before = structuredClone(previous);
		for (const input of [
			"",
			"show on",
			"help",
			"info",
			"ADD work",
			"/task list",
			"unknown",
			"clear",
			"clear --confirmed",
			"clear extra",
			"clear --start",
			"add",
			'add ""',
			'add "  "',
			"add two words",
			"add --start",
			"add x --text y",
			"add x --start --start",
			"add x --start true",
			"add x --blocked-by",
			"add x --blocked-by --start",
			"add x --blocked-by=1",
			"modify 1",
			"modify 1 --text",
			'modify 1 --text " "',
			"modify 1 --text a --text b",
			"modify 1 --wat x",
			"modify 1 --status pending",
			"modify 1 --status ready",
			"modify 1 --status blocked",
			"modify 1 --status start",
			"modify 1 --status expired",
			'modify 1 --status expired --reason " "',
			"modify 1 --reason why",
			"modify 1 --status done --reason why",
			"modify 1 --text --status",
			"modify 1 --start",
			"list --limit 1",
			"list --type all",
			"list --type open --type closed",
			"list extra",
			"list --type",
			'add "unclosed',
			"add 'unclosed",
			"add trailing\\",
			'add "trailing\\',
		]) {
			assert.throws(() => parseHumanTaskCommand(input), Error, input);
			const result = executeHumanTaskCommand(previous, input);
			assert.equal(result.changed, false, input);
			assert.ok(result.result.details.error, input);
			assert.deepEqual(result.state, before, input);
			assert.deepEqual(previous, before, input);
		}
	});
	it("rejects noncanonical and unsafe IDs, limits and malformed dependency lists", () => {
		for (const id of [
			"0",
			"01",
			"-1",
			"+1",
			"1.0",
			"1e2",
			"0x10",
			"NaN",
			"Infinity",
			"9007199254740992",
			"1x",
		])
			for (const input of [
				`modify ${id} --status done`,
				`add x --blocked-by ${id}`,
			])
				assert.throws(() => parseHumanTaskCommand(input), Error, input);
		for (const ids of ["1,", ",1", "1,,2", "one", "1, 2", " 1", "1,2 "])
			assert.throws(() =>
				parseHumanTaskCommand(`modify 1 --blocked-by "${ids}"`),
			);
		for (const limit of ["-1", "01", "1.2", "1e2", "9007199254740992"])
			assert.throws(() =>
				parseHumanTaskCommand(`list --type open --limit ${limit}`),
			);
	});
});
