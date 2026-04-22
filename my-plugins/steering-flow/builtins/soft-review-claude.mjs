#!/usr/bin/env node
// Soft review via Claude API for steering-flow.
// argv: [PROMPT]
//
// The builtin engine supplies config.args and llm_supplied_args as positional
// arguments. This helper does not consume the tape.
// Protocol: first stdout line is true|false; remaining lines are the reason.
// Returns false when Claude is unavailable or the prompt is empty.

const [prompt] = process.argv.slice(2);

if (!prompt || prompt.trim().length === 0) {
  console.log("false");
  console.log("No review prompt provided. Pass a non-empty prompt as the first argument.");
  process.exit(0);
}

// Conservative stub: no Claude API credentials wired in this context.
// Replace with a real implementation that calls the Claude API when credentials
// are available.
console.log("false");
console.log(
  `Claude reviewer unavailable. Prompt received: "${prompt.slice(0, 120)}${prompt.length > 120 ? "..." : ""}". ` +
  "Replace this script with a real Claude API implementation."
);
