#!/usr/bin/env node
// Basic self-check for steering-flow builtins.
// argv: [...config.args, ...llm_supplied_args]
//
// config.args (from YAML `args:`) are the rubric items the agent must satisfy.
// llm_supplied_args is the self-assessment text the LLM passes when invoking
// the action (typically one positional argument). This helper does not consume
// the tape.
//
// This stub accepts the self-assessment when its text contains a recognized
// success marker (case-insensitive): "done", "complete", "pass", "approved",
// "ok", "yes", "true", or "satisfied".  For a real self-check that invokes an
// LLM to evaluate the rubric, replace the body below while keeping the same
// stdout protocol.
//
// Protocol: first stdout line is true|false; remaining lines are the reason.

// All argv after the script path are either config.args or llm_supplied_args.
// The builtin-procedures.md example uses args: ["rubric item 1", "rubric item 2"],
// so config.args.length >= 1.  The last argv element is treated as the LLM's
// self-assessment; everything before it is the rubric.
const allArgs = process.argv.slice(2);

if (allArgs.length === 0) {
  console.log("false");
  console.log("No arguments provided. Pass rubric items as config.args and a self-assessment as the LLM argument.");
  process.exit(0);
}

// Last arg = LLM self-assessment; preceding args = rubric items.
const assessment = allArgs[allArgs.length - 1];
const rubric = allArgs.slice(0, allArgs.length - 1);

if (!assessment || assessment.trim().length === 0) {
  console.log("false");
  console.log("Empty self-assessment. The LLM must supply a non-empty assessment argument.");
  process.exit(0);
}

const SUCCESS_MARKERS = ["done", "complete", "pass", "approved", "ok", "yes", "true", "satisfied"];
const text = assessment.trim().toLowerCase();
const passed = SUCCESS_MARKERS.some(m => text === m || text.startsWith(m + " ") || text.startsWith(m + ".") || text.startsWith(m + ",") || text.includes(" " + m));

if (passed) {
  const rubricNote = rubric.length > 0 ? ` Rubric: [${rubric.join("; ")}].` : "";
  console.log("true");
  console.log(`Self-check passed.${rubricNote} Assessment: "${assessment.slice(0, 200)}"`);
} else {
  const rubricNote = rubric.length > 0 ? ` Rubric: [${rubric.join("; ")}].` : "";
  console.log("false");
  console.log(
    `Self-check failed.${rubricNote} Assessment: "${assessment.slice(0, 200)}". ` +
    `Signal completion by including one of: ${SUCCESS_MARKERS.join(", ")}.`
  );
}
