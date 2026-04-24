# Audit Batch 3 — Independent Confirmation
**Reviewer**: Fresh source-only review (no prior audit docs read)
**Date**: 2026-04-23
**Scope**: D2-001 through D2-004

---

## D2-001 — `submit-required-fields` doc example missing `${$TAPE_FILE}`

**Verdict: CONFIRMED**

**Evidence:**

`builtins/submit-required-fields.mjs` lines 13–22 show the script expects:
```
argv: [FIELD1, FIELD2, ..., ${$TAPE_FILE}]
```
Specifically:
```js
const tape_path = args[args.length - 1];   // last arg = tape path
const fields = args.slice(0, args.length - 1);
```
The script unconditionally treats the last positional arg as the tape file path. Without it, `tape_path` receives the last field name (e.g. `"TESTS_PASSED"`), `readFileSync` throws, and the condition returns `false` with a misleading error.

`builtin-registry.ts` `expandBuiltinCondition` expands `{ builtin, args? }` to:
```js
{ cmd: "node", args: [scriptPath, ...userArgs] }
```
It does **not** auto-append `${$TAPE_FILE}`. The user must supply it explicitly.

`docs/builtin-procedures.md` line 45 shows the example as:
```yaml
args: [PLAN_TEXT, CODE_WRITTEN, TESTS_PASSED]
```
No `${$TAPE_FILE}`. Lines 48–50 claim "the builtin receives the tape path explicitly via the engine's `${$TAPE_FILE}` interpolation" — but this is contradicted by the expansion code: nothing injects it. The example is broken as written.

**Fix**: The doc example must be:
```yaml
args: [PLAN_TEXT, CODE_WRITTEN, TESTS_PASSED, "${$TAPE_FILE}"]
```

---

## D2-002 — `self-check-basic.mjs` rubric is decorative

**Verdict: CONFIRMED**

**Evidence:**

`builtins/self-check-basic.mjs` line ~22:
```js
const rubric = allArgs.slice(0, allArgs.length - 1);
```
`rubric` is extracted from args. The pass/fail decision at line ~30:
```js
const passed = SUCCESS_MARKERS.some(
  m => text === m || text.startsWith(m + " ") || text.startsWith(m + ".") ||
       text.startsWith(m + ",") || text.includes(" " + m)
);
```
`passed` is computed solely from `assessment` (the last arg) against `SUCCESS_MARKERS`. The `rubric` array appears only inside a `rubricNote` string used in `console.log` output — it has zero influence on the boolean result.

A condition with `args: ["output is non-empty", "no placeholders", "done"]` passes identically to one with `args: ["done"]`. The rubric items are logged for human readability only.

---

## D2-003 — `self-check-basic.mjs` negation false-positive on `" done"`

**Verdict: CONFIRMED**

**Evidence:**

`SUCCESS_MARKERS` includes `"done"`. The matching logic at line ~30:
```js
text.includes(" " + m)   // for m = "done" → text.includes(" done")
```
The string `"not done"` contains the substring `" done"` (space + done). Therefore an assessment of `"not done"` satisfies this branch and `passed` evaluates to `true` — a false positive.

Same issue applies to any marker preceded by a negation word: `"not complete"` matches `" complete"`, `"not ok"` matches `" ok"`.

The `text.includes(" " + m)` branch provides no negation guard. A word-boundary check (e.g. regex `\bdone\b` with a preceding-word exclusion) would be required to fix this correctly.

---

## D2-004 — `chainEpsilon` calls `runCondition` without `namedArgs`

**Verdict: CONFIRMED**

**Evidence:**

`engine.ts` line 245 — `executeAction` call:
```ts
const condResult = await runCondition(
  action.condition, tapePath, positionalArgs, cwd, runtime.flow_dir, namedArgs
);
```
`namedArgs` is built at lines 240–242 by mapping `action.arguments[i].arg_name` → `positionalArgs[i]`.

`engine.ts` line 330 — `chainEpsilon` call:
```ts
const res = await runCondition(act.condition, tapePath, [], cwd, runtime.flow_dir);
```
The sixth parameter (`namedArgs`) is omitted entirely. `runCondition`'s signature (line 67) defaults it to `{}`:
```ts
namedArgs: Record<string, string> = {}
```
So `interpolatePlaceholders` receives an empty map. Any `${arg-name}` placeholder in an epsilon condition's `cmd` or `args` is left as the literal string `"${arg-name}"` rather than being substituted.

Epsilon states are documented as having no LLM args, so in practice epsilon conditions are unlikely to use `${arg-name}` placeholders — but the asymmetry is a latent bug: if a flow author writes an epsilon condition referencing a named placeholder, it will silently pass through unresolved with no error.

---

## Summary

| ID | Verdict | Root location |
|----|---------|---------------|
| D2-001 | CONFIRMED | `docs/builtin-procedures.md` line 45 — missing `${$TAPE_FILE}` in example |
| D2-002 | CONFIRMED | `builtins/self-check-basic.mjs` ~line 30 — `rubric` never read in `passed` |
| D2-003 | CONFIRMED | `builtins/self-check-basic.mjs` ~line 30 — `text.includes(" done")` matches `"not done"` |
| D2-004 | CONFIRMED | `engine.ts` line 330 — `chainEpsilon` omits `namedArgs` from `runCondition` call |

All four findings independently verified from source. No findings rejected.
