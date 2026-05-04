#!/usr/bin/env node
// argv: [KEY, EXPECTED_VALUE, tape_path]
// Requires a tape key to be exactly the expected value and deletes it on success.
import { readFileSync, writeFileSync } from "node:fs";

const [key, expected, tapePath] = process.argv.slice(2);
const tape = JSON.parse(readFileSync(tapePath, "utf-8"));
const value = tape[key];

if (value === expected) {
	delete tape[key];
	writeFileSync(tapePath, JSON.stringify(tape, null, 2));
	console.log("true");
	console.log(`${key} matched ${expected}; issue cleared from tape`);
} else {
	console.log("false");
	console.log(`${key} must be ${expected}. Current value: ${JSON.stringify(value)}`);
}
