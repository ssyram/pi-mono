#!/usr/bin/env node
// Validate non-empty args for steering-flow builtins.
// argv: [ARG1, ARG2, ..., tape_path]   (when ${$TAPE_FILE} is in args)
//   — OR —
// argv: [ARG1, ARG2, ...]              (when ${$TAPE_FILE} is absent)
//
// Verifies that every positional argument before the tape path is non-empty
// (i.e. not undefined, not an empty string, not whitespace-only).
// When no arguments are provided at all the check fails.
//
// Because this helper cannot know whether ${$TAPE_FILE} was in args or not, it
// treats the LAST argument specially only when it ends with ".json" and looks
// like a file path — otherwise all args are validated as data values.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.log("false");
  console.log("No arguments provided. At least one non-empty argument is required.");
  process.exit(0);
}

// Heuristic: last arg is a tape path when it ends with ".json"
const lastArg = rawArgs[rawArgs.length - 1];
const looksLikeTape = lastArg.endsWith(".json");
const dataArgs = looksLikeTape ? rawArgs.slice(0, rawArgs.length - 1) : rawArgs;

if (dataArgs.length === 0) {
  console.log("false");
  console.log("No data arguments provided (only a tape path was detected).");
  process.exit(0);
}

const emptyIndices = dataArgs
  .map((a, i) => ({ a, i }))
  .filter(({ a }) => !a || a.trim().length === 0)
  .map(({ i }) => i + 1); // 1-based for human readability

if (emptyIndices.length === 0) {
  console.log("true");
  console.log(`All ${dataArgs.length} argument(s) are non-empty.`);
} else {
  console.log("false");
  console.log(
    `Argument(s) at position(s) ${emptyIndices.join(", ")} are empty or whitespace-only. ` +
    "All arguments must be non-empty strings."
  );
}
