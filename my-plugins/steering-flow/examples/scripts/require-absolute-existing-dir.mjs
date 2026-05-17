#!/usr/bin/env node
// Verify that a tape key holds an ABSOLUTE path to an EXISTING directory.
// argv: [TAPE_KEY, tape_path]
//
// Used by setup gates to make WORKING_DIR a real directory before the flow
// starts trusting "file under WORKING_DIR" gates.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 2) {
	console.log("false");
	console.log("Usage: require-absolute-existing-dir.mjs TAPE_KEY tape_path");
	process.exit(0);
}

const [key, tape_path] = args;

let tape;
try {
	tape = JSON.parse(readFileSync(tape_path, "utf-8"));
} catch (err) {
	console.log("false");
	console.log(`Could not read tape at "${tape_path}": ${err.message}`);
	process.exit(0);
}

const value = tape[key];
if (!value || typeof value !== "string" || !value.trim()) {
	console.log("false");
	console.log(`Tape.${key} is missing or empty.`);
	process.exit(0);
}
if (!isAbsolute(value)) {
	console.log("false");
	console.log(`Tape.${key} must be an absolute path; got "${value}".`);
	process.exit(0);
}

let st;
try {
	st = statSync(value);
} catch (err) {
	console.log("false");
	console.log(`Tape.${key}="${value}" does not exist: ${err.message}`);
	process.exit(0);
}
if (!st.isDirectory()) {
	console.log("false");
	console.log(`Tape.${key}="${value}" exists but is not a directory.`);
	process.exit(0);
}

console.log("true");
console.log(`${key} resolves to absolute existing directory: ${value}`);
