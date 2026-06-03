#!/usr/bin/env node
// Verify that a markdown file under WORKING_DIR has a YAML frontmatter key
// equal to an expected value (or matching one of a comma-separated set).
//
// argv: [REL_PATH, KEY, EXPECTED_VALUE_OR_CSV, tape_path]
//
// REL_PATH:        relative path under tape.WORKING_DIR.
// KEY:             frontmatter key to read.
// EXPECTED:        a single expected value, OR comma-separated allowed values.
// tape_path:       last arg as usual.
//
// Frontmatter is the first leading `---` ... `---` block. Key matching is
// line-based: `<key>: <value>` (whitespace-trimmed). No YAML library is used
// to keep this dependency-free; values must therefore be simple scalars.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 4) {
	console.log("false");
	console.log("Usage: require-frontmatter-eq.mjs REL_PATH KEY EXPECTED tape_path");
	process.exit(0);
}

const [rel, key, expectedRaw, tape_path] = args;

let tape;
try {
	tape = JSON.parse(readFileSync(tape_path, "utf-8"));
} catch (err) {
	console.log("false");
	console.log(`Could not read tape at "${tape_path}": ${err.message}`);
	process.exit(0);
}

const workdir = tape.WORKING_DIR;
if (!workdir || typeof workdir !== "string" || !workdir.trim()) {
	console.log("false");
	console.log("Tape.WORKING_DIR is missing.");
	process.exit(0);
}
if (!isAbsolute(workdir)) {
	console.log("false");
	console.log(`Tape.WORKING_DIR must be an absolute path; got "${workdir}".`);
	process.exit(0);
}
if (isAbsolute(rel)) {
	console.log("false");
	console.log(`REL_PATH must be relative to WORKING_DIR; got "${rel}".`);
	process.exit(0);
}

const full = resolve(workdir, rel);
if (!full.startsWith(workdir)) {
	console.log("false");
	console.log(`REL_PATH "${rel}" escapes WORKING_DIR.`);
	process.exit(0);
}
if (!existsSync(full)) {
	console.log("false");
	console.log(`File does not exist under WORKING_DIR: ${rel}.`);
	process.exit(0);
}

const text = readFileSync(full, "utf-8");
const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fmMatch) {
	console.log("false");
	console.log(`No leading YAML frontmatter block found in ${rel}.`);
	process.exit(0);
}

const frontmatter = fmMatch[1];
const keyRe = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*:\\s*(.*?)\\s*$`, "m");
const km = frontmatter.match(keyRe);
if (!km) {
	console.log("false");
	console.log(`Frontmatter in ${rel} does not contain key "${key}".`);
	process.exit(0);
}

const actualRaw = km[1].trim();
// strip optional surrounding quotes for scalar comparison.
const actual = actualRaw.replace(/^['"]|['"]$/g, "");

const expectedSet = expectedRaw.split(",").map((s) => s.trim()).filter(Boolean);
if (expectedSet.length === 0) {
	console.log("false");
	console.log("EXPECTED set is empty.");
	process.exit(0);
}

if (expectedSet.includes(actual)) {
	console.log("true");
	console.log(`${rel}: ${key}="${actual}" matches expected {${expectedSet.join(",")}}.`);
} else {
	console.log("false");
	console.log(`${rel}: ${key}="${actual}" not in expected {${expectedSet.join(",")}}.`);
}
