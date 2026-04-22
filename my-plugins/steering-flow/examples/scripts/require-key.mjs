#!/usr/bin/env node
// argv: [KEY, EXPECTED_VALUE, tape_path]  (config args, then tape_path appended last)
import { readFileSync } from "node:fs";
const [key, expected, tape] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tape, "utf-8"));
if (t[key] === expected) {
	console.log("true");
	console.log(`${key} matches '${expected}'`);
} else {
	console.log("false");
	console.log(`Set ${key}=${expected} on the tape via save-to-steering-flow. Current value: ${JSON.stringify(t[key])}`);
}
