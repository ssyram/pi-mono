#!/usr/bin/env node
// argv: [CAPABILITY_KEY, tape_path]
// Requires fresh-agent spawning support to be explicitly confirmed on tape.
import { readFileSync } from "node:fs";

const [key, tapePath] = process.argv.slice(2);
const tape = JSON.parse(readFileSync(tapePath, "utf-8"));
const value = tape[key];

if (value === true || value === 1 || value === "1" || value === "true" || value === "available") {
	console.log("true");
	console.log(`${key} confirms fresh-agent capability is available.`);
} else {
	console.log("false");
	console.log(`${key} must confirm fresh-agent capability. Current value: ${JSON.stringify(value)}`);
}
