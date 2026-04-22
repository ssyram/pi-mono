#!/usr/bin/env node
// Soft review wrapper for steering-flow builtins.
// argv: [PROMPT, tape_path]
//
// Returns false (with reason) when no prompt is provided or when the executor
// (e.g. a real LLM review API) is unavailable, so validation pipelines fail
// safely rather than silently passing.  Does NOT require real API calls.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

const [prompt, _tape] = process.argv.slice(2);

if (!prompt || prompt.trim().length === 0) {
  console.log("false");
  console.log("No review prompt provided. Pass a non-empty prompt as the first argument.");
  process.exit(0);
}

// Conservative stub: no real executor available in this environment.
// Downstream tooling should replace this script with one that calls the
// actual review service when a real executor is configured.
console.log("false");
console.log(
  `Review executor unavailable. Prompt received: "${prompt.slice(0, 120)}${prompt.length > 120 ? "..." : ""}". ` +
  "Replace this script with a real reviewer implementation."
);
