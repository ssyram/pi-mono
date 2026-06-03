#!/usr/bin/env node
// argv: [KEY, tape_path]
// Returns true if tape[KEY] is exactly 0 (number or string "0").
import { readFileSync } from "node:fs";
const [key, tape] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tape, "utf-8"));
const v = t[key];
if (v === 0 || v === "0") {
	console.log("true");
	console.log(`${key} is zero`);
} else {
	console.log("false");
	console.log(`${key} must be 0. Current value: ${JSON.stringify(v)}`);
}
