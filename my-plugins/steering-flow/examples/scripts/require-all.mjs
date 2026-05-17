#!/usr/bin/env node
// Run multiple node helper scripts under examples/scripts/ in order.
// All must return `true` on the first stdout line for this composite to
// return `true`. Stops at the first false and reports which child failed.
//
// argv: [HELPER1, HELPER1_ARG1, HELPER1_ARG2, ..., '--', HELPER2, ..., '--', ..., tape_path]
//
// Each child receives its declared args followed by the tape path (last arg
// of the composite). Children resolve relative to this script's directory,
// so callers pass bare names like `require-file-in-workdir.mjs`.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length < 3) {
	console.log("false");
	console.log("Usage: require-all.mjs HELPER1 [args...] [-- HELPER2 [args...]]... tape_path");
	process.exit(0);
}

const tape_path = args[args.length - 1];
const inner = args.slice(0, args.length - 1);

// Validate tape exists / parses; helpers will re-read it themselves but a
// failure here gives a clearer message than per-child "could not read tape".
try {
	JSON.parse(readFileSync(tape_path, "utf-8"));
} catch (err) {
	console.log("false");
	console.log(`Could not read tape at "${tape_path}": ${err.message}`);
	process.exit(0);
}

// Split on '--'.
const groups = [];
let buf = [];
for (const a of inner) {
	if (a === "--") {
		if (buf.length > 0) groups.push(buf);
		buf = [];
	} else {
		buf.push(a);
	}
}
if (buf.length > 0) groups.push(buf);

if (groups.length === 0) {
	console.log("false");
	console.log("require-all.mjs: no child helpers specified.");
	process.exit(0);
}

const reasons = [];
for (const g of groups) {
	const [helper, ...helperArgs] = g;
	const child = spawnSync(
		process.execPath,
		[join(SCRIPT_DIR, helper), ...helperArgs, tape_path],
		{ encoding: "utf-8" },
	);
	if (child.error) {
		console.log("false");
		console.log(`require-all.mjs: failed to spawn '${helper}': ${child.error.message}`);
		process.exit(0);
	}
	const out = (child.stdout || "").split(/\r?\n/);
	const verdict = (out[0] || "").trim();
	const reason = out.slice(1).join("\n").trim();
	if (verdict !== "true") {
		console.log("false");
		console.log(`require-all.mjs: child '${helper}' returned ${verdict || "<no verdict>"}: ${reason}`);
		process.exit(0);
	}
	reasons.push(`${helper}: ${reason}`);
}

console.log("true");
console.log(reasons.join(" | "));
