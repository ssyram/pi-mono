#!/usr/bin/env node
// Soft review via the pi agent provider for steering-flow.
// argv: [PROMPT]
//
// The builtin engine supplies config.args and llm_supplied_args as positional
// arguments. This helper does not consume the tape.
// Protocol: first stdout line is true|false; remaining lines are the reason.
// Returns false when the pi provider is unavailable or the prompt is empty.

const [prompt] = process.argv.slice(2);

if (!prompt || prompt.trim().length === 0) {
  console.log("false");
  console.log("No review prompt provided. Pass a non-empty prompt as the first argument.");
  process.exit(0);
}

// Conservative stub: pi provider context not available as a subprocess.
// Replace with a real implementation that routes through pi's credential context
// when running inside a pi-hosted flow.
console.log("false");
console.log(
  `Pi reviewer unavailable. Prompt received: "${prompt.slice(0, 120)}${prompt.length > 120 ? "..." : ""}". ` +
  "Replace this script with a real pi provider implementation."
);
