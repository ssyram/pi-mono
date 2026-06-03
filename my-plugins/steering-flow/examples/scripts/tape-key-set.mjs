#!/usr/bin/env node
// argv: [KEY, VALUE, tape_path]
//
// Side-effect helper used as a condition step. Always returns true.
//
// Writes tape[KEY] = VALUE (literal string; if VALUE is "-1" it is stored
// as the number -1; if VALUE is "" the key is deleted; otherwise the
// string is stored verbatim).
//
// Intended use: entry-clear of LLM-submitted counter keys (e.g., set
// NON_DECISION_COUNT=-1 on entry to count_gate). Pair with require-all so
// the same transition runs the assertion + the clear together.
//
// Protocol: first stdout line is "true"; second line is the reason.
import { readFileSync, writeFileSync } from "node:fs";

const [key, valueRaw, tapePath] = process.argv.slice(2);

if (!key || valueRaw === undefined || !tapePath) {
	console.log("false");
	console.log("Usage: tape-key-set.mjs KEY VALUE tape_path");
	process.exit(0);
}

let tape;
try {
	tape = JSON.parse(readFileSync(tapePath, "utf-8"));
} catch (err) {
	console.log("false");
	console.log(`Could not read tape at "${tapePath}": ${err.message}`);
	process.exit(0);
}

let nextValue;
if (valueRaw === "") {
	delete tape[key];
	nextValue = "<deleted>";
} else if (valueRaw === "-1") {
	tape[key] = -1;
	nextValue = -1;
} else if (/^-?\d+$/.test(valueRaw)) {
	tape[key] = Number(valueRaw);
	nextValue = Number(valueRaw);
} else {
	tape[key] = valueRaw;
	nextValue = valueRaw;
}

writeFileSync(tapePath, JSON.stringify(tape, null, 2));

console.log("true");
console.log(`Set ${key} = ${JSON.stringify(nextValue)} on tape (entry-clear).`);
