#!/usr/bin/env node
// Require that a file (or every file in a list) exists relative to tape.WORKING_DIR.
// argv: [REL_PATH_OR_CSV, tape_path]
//
// REL_PATH_OR_CSV: a single relative path, or a comma-separated list of relative paths.
// All paths are resolved against the absolute tape.WORKING_DIR.
// True iff WORKING_DIR is a non-empty string AND every listed file exists.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 2) {
	console.log("false");
	console.log("Usage: require-file-in-workdir.mjs REL_PATH[,REL_PATH...] tape_path");
	process.exit(0);
}

const [spec, tape_path] = args;

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
	console.log("Tape.WORKING_DIR is missing. Set TARGET_DIR and WORKING_DIR in setup.");
	process.exit(0);
}
if (!isAbsolute(workdir)) {
	console.log("false");
	console.log(`Tape.WORKING_DIR must be an absolute path; got "${workdir}".`);
	process.exit(0);
}

const rels = spec.split(",").map((s) => s.trim()).filter(Boolean);
if (rels.length === 0) {
	console.log("false");
	console.log("No relative paths provided.");
	process.exit(0);
}

const missing = [];
for (const rel of rels) {
	if (isAbsolute(rel)) {
		missing.push(`${rel} (must be relative to WORKING_DIR)`);
		continue;
	}
	const full = resolve(workdir, rel);
	if (!full.startsWith(workdir)) {
		missing.push(`${rel} (escapes WORKING_DIR)`);
		continue;
	}
	if (!existsSync(full)) missing.push(rel);
}

if (missing.length === 0) {
	console.log("true");
	console.log(`All required files present under WORKING_DIR: ${rels.join(", ")}`);
} else {
	console.log("false");
	console.log(`Missing or invalid files under WORKING_DIR: ${missing.join("; ")}.`);
}
