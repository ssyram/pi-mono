#!/usr/bin/env node
// argv: [KEY1, KEY2, tape_path]
// Returns true if BOTH tape[KEY1] and tape[KEY2] are zero.
import { readFileSync } from "node:fs";
const [key1, key2, tape] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tape, "utf-8"));
const isZero = (v) => v === 0 || v === "0";
if (isZero(t[key1]) && isZero(t[key2])) {
	console.log("true");
	console.log(`Both ${key1} and ${key2} are zero — no items remaining.`);
} else {
	console.log("false");
	console.log(`${key1}=${JSON.stringify(t[key1])}, ${key2}=${JSON.stringify(t[key2])}. Both must be 0 to proceed.`);
}
