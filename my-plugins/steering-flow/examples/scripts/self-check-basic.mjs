#!/usr/bin/env node
// Basic self-check for steering-flow builtins.
// argv: [CHECK_KEY, tape_path]
//
// Reads the tape and checks that the value stored at CHECK_KEY is the string
// "done" (case-insensitive).  Intended for lightweight self-verification steps
// where an agent marks a key "done" once it has completed the check.
//
// For a real self-check that invokes an LLM, replace the body below while
// keeping the same stdout protocol.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

import { readFileSync } from "node:fs";

const [checkKey, tapePath] = process.argv.slice(2);

if (!checkKey || !tapePath) {
  console.log("false");
  console.log("Usage: self-check-basic.mjs CHECK_KEY tape_path");
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

const value = tape[checkKey];
if (typeof value === "string" && value.trim().toLowerCase() === "done") {
  console.log("true");
  console.log(`Self-check passed: ${checkKey}="${value}"`);
} else {
  console.log("false");
  console.log(
    `Self-check failed: ${checkKey}=${JSON.stringify(value)}. ` +
    `Set ${checkKey}=done on the tape via save-to-steering-flow once the check is complete.`
  );
}
