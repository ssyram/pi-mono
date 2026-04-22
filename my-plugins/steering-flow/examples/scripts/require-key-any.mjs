#!/usr/bin/env node
// argv: [KEY, tape_path]
import { readFileSync } from "node:fs";
const [key, tape] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tape, "utf-8"));
if (typeof t[key] === "string" && t[key].length > 0) {
	console.log("true");
	console.log(`${key} is set: ${t[key]}`);
} else {
	console.log("false");
	console.log(`Save ${key}=<something> to the tape via save-to-steering-flow.`);
}
