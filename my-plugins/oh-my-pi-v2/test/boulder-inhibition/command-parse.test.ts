import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBoulderSetCommand } from "../../boulder-inhibition/command.ts";

test("parse: empty input and other task subcommands are unhandled", () => {
	for (const input of ["", " \t\n\r", "list", "set loop true", "status boulder", "boulderish set loop true", "/task boulder set loop true"]) {
		assert.deepEqual(parseBoulderSetCommand(input), { kind: "unhandled" }, JSON.stringify(input));
	}
});

test("parse: all boolean spellings and case-insensitive keywords preserve the source token", () => {
	const values: readonly (readonly [string, boolean])[] = [
		["true", true], ["TRUE", true], ["TrUe", true], ["t", true], ["T", true],
		["false", false], ["FALSE", false], ["FaLsE", false], ["f", false], ["F", false],
	];
	for (const [word, value] of values) {
		for (const type of ["Loop", "__proto__", "constructor", "provider/Name", "来源", "false"]) {
			assert.deepEqual(parseBoulderSetCommand(`bOuLdEr SeT ${type} ${word}`), {
				kind: "set", signal: { type, value },
			});
		}
	}
});

test("parse: arbitrary whitespace separates tokens, including surrounding Unicode whitespace", () => {
	for (const space of [" ", "\t", "\n", "\r\n", "\v", "\f", "\u00a0", "\u2003", "\u2028", "\ufeff"]) {
		assert.deepEqual(parseBoulderSetCommand(`${space}boulder${space}set${space}Loop${space}T${space}`), {
			kind: "set", signal: { type: "Loop", value: true },
		});
	}
});

test("parse: matched boulder with wrong arity, verb or boolean returns the exact usage", () => {
	const invalid = [
		"boulder", "BOULDER set", "boulder set loop", "boulder set loop true extra",
		"boulder set loop true extra more", "boulder get loop true", "boulder stop loop true",
		"boulder start loop true", "boulder clear loop false", "boulder SET loop yes",
		"boulder set loop no", "boulder set loop 1", "boulder set loop 0", "boulder set loop on",
		"boulder set loop off", "boulder set loop null", "boulder set loop undefined",
		"boulder set loop true,false", "boulder set loop tt", "boulder set loop ff",
		'boulder set loop "true"', 'boulder set "two words" true', "boulder set    true",
	];
	for (const input of invalid) {
		assert.deepEqual(parseBoulderSetCommand(input), {
			kind: "invalid", message: "Usage: /task boulder set <type> <true|false|t|f>",
		}, input);
	}
});

test("parse: quotes are literal source characters, never decoded", () => {
	for (const type of ['"Loop"', "'Loop'", '""', "''"]) {
		assert.deepEqual(parseBoulderSetCommand(`boulder set ${type} f`), {
			kind: "set", signal: { type, value: false },
		});
	}
});
