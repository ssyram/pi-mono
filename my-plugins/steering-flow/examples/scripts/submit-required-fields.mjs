#!/usr/bin/env node
// Submit required-fields validator for steering-flow builtins.
// argv: [FIELD1, FIELD2, ..., tape_path]
//
// Reads the tape and verifies that every named field is present and non-empty.
// The tape path is always the last argument; all preceding args are field names.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log("false");
  console.log("Usage: submit-required-fields.mjs FIELD1 [FIELD2 ...] tape_path");
  process.exit(0);
}

const tape_path = args[args.length - 1];
const fields = args.slice(0, args.length - 1);

let tape;
try {
  tape = JSON.parse(readFileSync(tape_path, "utf-8"));
} catch (err) {
  console.log("false");
  console.log(`Could not read tape at "${tape_path}": ${err.message}`);
  process.exit(0);
}

const missing = fields.filter(
  (f) => tape[f] === undefined || tape[f] === null || String(tape[f]).trim() === ""
);

if (missing.length === 0) {
  console.log("true");
  console.log(`All required fields present: ${fields.join(", ")}`);
} else {
  console.log("false");
  console.log(
    `Missing or empty required fields: ${missing.join(", ")}. ` +
    "Set them on the tape via save-to-steering-flow before submitting."
  );
}
