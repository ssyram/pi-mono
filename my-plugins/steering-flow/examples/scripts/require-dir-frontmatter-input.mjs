#!/usr/bin/env node
// argv: [REL_DIR, EXPECTED_TOKEN, tape_path]
//
// For every *.md file directly under <tape.WORKING_DIR>/<REL_DIR>
// (excluding "index.md"), parse the leading YAML frontmatter and confirm
// `inputs:` contains EXPECTED_TOKEN as one of its entries.
//
// REL_DIR:        relative directory under tape.WORKING_DIR (e.g. "challenge").
// EXPECTED_TOKEN: literal token to find inside inputs (e.g. "lessons.md").
//
// inputs is parsed in either block-sequence or inline-sequence form (same
// rules as require-frontmatter-input.mjs).
//
// True iff REL_DIR exists, contains at least one *.md (other than
// index.md), and every such file declares EXPECTED_TOKEN inside its
// inputs list.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { isAbsolute, resolve, join } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 3) {
	console.log("false");
	console.log("Usage: require-dir-frontmatter-input.mjs REL_DIR EXPECTED_TOKEN tape_path");
	process.exit(0);
}

const [relDir, expected, tapePath] = args;

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
if (isAbsolute(relDir)) {
	console.log("false");
	console.log(`REL_DIR must be relative to WORKING_DIR; got "${relDir}".`);
	process.exit(0);
}

const fullDir = resolve(workdir, relDir);
if (!fullDir.startsWith(workdir)) {
	console.log("false");
	console.log(`REL_DIR "${relDir}" escapes WORKING_DIR.`);
	process.exit(0);
}
if (!existsSync(fullDir) || !statSync(fullDir).isDirectory()) {
	console.log("false");
	console.log(`Directory does not exist under WORKING_DIR: ${relDir}.`);
	process.exit(0);
}

const stripQuotes = (s) => s.trim().replace(/^['"]|['"]$/g, "").trim();
function extractInputs(frontmatter) {
	const inlineMatch = frontmatter.match(/^\s*inputs\s*:\s*\[(.*?)\]\s*$/m);
	if (inlineMatch) return inlineMatch[1].split(",").map(stripQuotes).filter(Boolean);
	const lines = frontmatter.split(/\r?\n/);
	const idx = lines.findIndex((l) => /^\s*inputs\s*:\s*$/.test(l));
	if (idx === -1) return null;
	const collected = [];
	for (let i = idx + 1; i < lines.length; i++) {
		const m = lines[i].match(/^\s*-\s+(.*?)\s*$/);
		if (m) { collected.push(stripQuotes(m[1])); continue; }
		if (/^\s*$/.test(lines[i])) continue;
		break;
	}
	return collected;
}

const entries = readdirSync(fullDir).filter((n) => n.endsWith(".md") && n !== "index.md");
if (entries.length === 0) {
	console.log("false");
	console.log(`No *.md reports under ${relDir}/ (index.md is excluded).`);
	process.exit(0);
}

const failures = [];
for (const name of entries) {
	const full = join(fullDir, name);
	const text = readFileSync(full, "utf-8");
	const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fm) { failures.push(`${relDir}/${name}: no YAML frontmatter.`); continue; }
	const inputs = extractInputs(fm[1]);
	if (inputs === null) { failures.push(`${relDir}/${name}: missing 'inputs:' key.`); continue; }
	if (!inputs.includes(expected)) {
		failures.push(`${relDir}/${name}: 'inputs' missing ${JSON.stringify(expected)} (got [${inputs.map((s) => JSON.stringify(s)).join(", ")}]).`);
	}
}

if (failures.length === 0) {
	console.log("true");
	console.log(`All ${entries.length} report(s) under ${relDir}/ declare ${JSON.stringify(expected)} in inputs.`);
} else {
	console.log("false");
	console.log(failures.join("\n"));
}
