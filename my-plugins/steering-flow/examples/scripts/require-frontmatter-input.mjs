#!/usr/bin/env node
// argv: [REL_PATH_OR_CSV, EXPECTED_TOKEN, tape_path]
//
// For each markdown file at <REL_PATH> under tape.WORKING_DIR, parse the
// leading YAML frontmatter and confirm the `inputs:` block contains
// EXPECTED_TOKEN as one of its bullet entries.
//
// REL_PATH_OR_CSV: comma-separated relative paths. All must satisfy.
// EXPECTED_TOKEN:  string token (matched literally; whitespace and quotes
//                  trimmed). Typical value: "lessons.md".
//
// inputs is parsed as a YAML block sequence:
//   inputs:
//     - spec/
//     - <TARGET_DIR>
//     - lessons.md
//
// or as an inline flow sequence on the key line:
//   inputs: [spec/, <TARGET_DIR>, lessons.md]
//
// Anything else fails with a precise reason.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 3) {
	console.log("false");
	console.log("Usage: require-frontmatter-input.mjs REL_PATH[,REL_PATH...] EXPECTED_TOKEN tape_path");
	process.exit(0);
}

const [relSpec, expected, tapePath] = args;

let tape;
try {
	tape = JSON.parse(readFileSync(tapePath, "utf-8"));
} catch (err) {
	console.log("false");
	console.log(`Could not read tape at "${tapePath}": ${err.message}`);
	process.exit(0);
}

const workdir = tape.WORKING_DIR;
if (!workdir || typeof workdir !== "string" || !workdir.trim() || !isAbsolute(workdir)) {
	console.log("false");
	console.log(`Tape.WORKING_DIR must be an absolute path; got ${JSON.stringify(workdir)}.`);
	process.exit(0);
}

const rels = relSpec.split(",").map((s) => s.trim()).filter(Boolean);
if (rels.length === 0) {
	console.log("false");
	console.log("No relative paths provided.");
	process.exit(0);
}

const stripQuotes = (s) => s.trim().replace(/^['"]|['"]$/g, "").trim();

function extractInputs(frontmatter) {
	// Inline form: inputs: [a, b, c]
	const inlineMatch = frontmatter.match(/^\s*inputs\s*:\s*\[(.*?)\]\s*$/m);
	if (inlineMatch) {
		return inlineMatch[1].split(",").map(stripQuotes).filter(Boolean);
	}
	// Block form: inputs: \n  - a\n  - b
	const lines = frontmatter.split(/\r?\n/);
	const idx = lines.findIndex((l) => /^\s*inputs\s*:\s*$/.test(l));
	if (idx === -1) return null;
	const collected = [];
	for (let i = idx + 1; i < lines.length; i++) {
		const m = lines[i].match(/^\s*-\s+(.*?)\s*$/);
		if (m) {
			collected.push(stripQuotes(m[1]));
			continue;
		}
		// Stop at the next non-blank, non-bullet line (likely next key or end).
		if (/^\s*$/.test(lines[i])) continue;
		break;
	}
	return collected;
}

const failures = [];
for (const rel of rels) {
	if (isAbsolute(rel)) {
		failures.push(`${rel}: must be relative to WORKING_DIR.`);
		continue;
	}
	const full = resolve(workdir, rel);
	if (!full.startsWith(workdir)) {
		failures.push(`${rel}: escapes WORKING_DIR.`);
		continue;
	}
	if (!existsSync(full)) {
		failures.push(`${rel}: file does not exist.`);
		continue;
	}
	const text = readFileSync(full, "utf-8");
	const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fm) {
		failures.push(`${rel}: no YAML frontmatter block.`);
		continue;
	}
	const inputs = extractInputs(fm[1]);
	if (inputs === null) {
		failures.push(`${rel}: frontmatter missing 'inputs:' key.`);
		continue;
	}
	if (!inputs.includes(expected)) {
		failures.push(`${rel}: 'inputs' = [${inputs.map((s) => JSON.stringify(s)).join(", ")}] does not contain ${JSON.stringify(expected)}.`);
		continue;
	}
}

if (failures.length === 0) {
	console.log("true");
	console.log(`All listed reports declare ${JSON.stringify(expected)} in their frontmatter inputs.`);
} else {
	console.log("false");
	console.log(failures.join("\n"));
}
