#!/usr/bin/env node
// argv: [KEY, FORBIDDEN_VALUE, tape_path]
//
// Returns true if tape[KEY] exists AND is NOT equal to FORBIDDEN_VALUE.
// Used for count_gate entry-clear protocol: the gate refuses to advance
// until the LLM has explicitly submitted a value other than -1.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readFileSync } from "node:fs";

const [key, forbidden, tapePath] = process.argv.slice(2);

if (!key || forbidden === undefined || !tapePath) {
	console.log("false");
	console.log("Usage: require-key-not-eq.mjs KEY FORBIDDEN_VALUE tape_path");
	process.exit(0);
}

let tape;
try {
	tape = JSON.parse(readFileSync(tapePath, "utf-8"));
} catch (err) {
	console.log("false");
	console.log(`Could not read tape at "${tapePath}": ${err.message}`);
	process.exit(0);
}

const value = tape[key];
if (value === undefined) {
	console.log("false");
	console.log(`Tape key "${key}" is not set. Use save-to-steering-flow to submit it.`);
	process.exit(0);
}

// Coerce both to strings for comparison (handles "-1" vs -1).
const valueStr = String(value);
const forbiddenStr = String(forbidden);

if (valueStr === forbiddenStr) {
	console.log("false");
	console.log(`Tape key "${key}" is ${JSON.stringify(value)}, which equals the forbidden value ${JSON.stringify(forbidden)}. Submit a different value.`);
} else {
	console.log("true");
	console.log(`Tape key "${key}" = ${JSON.stringify(value)} (≠ ${JSON.stringify(forbidden)}).`);
}
