#!/usr/bin/env node
// Validate non-empty args for steering-flow builtins.
// argv: [...config.args, ...llm_supplied_args]
//
// Verifies that every positional argument is non-empty (i.e. not undefined,
// not an empty string, not whitespace-only). This helper does not consume
// the tape and no tape path is injected into argv.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.log("false");
  console.log("No arguments provided. At least one non-empty argument is required.");
  process.exit(0);
}

const emptyIndices = rawArgs
  .map((a, i) => ({ a, i }))
  .filter(({ a }) => !a || a.trim().length === 0)
  .map(({ i }) => i + 1); // 1-based for human readability

if (emptyIndices.length === 0) {
  console.log("true");
  console.log(`All ${rawArgs.length} argument(s) are non-empty.`);
} else {
  console.log("false");
  console.log(
    `Argument(s) at position(s) ${emptyIndices.join(", ")} are empty or whitespace-only. ` +
    "All arguments must be non-empty strings."
  );
}
