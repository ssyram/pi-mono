#!/usr/bin/env node
// argv: [KEY, tape_path]
// Returns true if tape[KEY] is a number > 0.
import { readFileSync } from "node:fs";
const [key, tape] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tape, "utf-8"));
const v = Number(t[key]);
if (Number.isFinite(v) && v > 0) {
	console.log("true");
	console.log(`${key}=${v} (> 0)`);
} else {
	console.log("false");
	console.log(`${key} must be > 0. Current value: ${JSON.stringify(t[key])}`);
}
