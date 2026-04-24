# Hoare Audit — Dimension D2: External-API Contracts

**Plugin:** steering-flow  
**Auditor:** Sisyphus-Junior  
**Date:** 2026-04-23  
**Scope:** Condition stdout protocol (engine ↔ child-process boundary), builtin argv contracts, builtin postconditions, parse-time expansion invariants.  
**Baseline:** `docs/audit/Round2/spec-gate.md`, `docs/builtin-procedures.md`, `README.md` stdout protocol section.

---

## Summary

| ID | Title | Severity | File |
|----|-------|----------|------|
| D2-001 | `submit/required-fields` doc example omits `${$TAPE_FILE}` — tape path resolves to last field name | HIGH | `docs/builtin-procedures.md` |
| D2-002 | `self-check/basic` never evaluates rubric items — postcondition is vacuously satisfied | MEDIUM | `builtins/self-check-basic.mjs:32,42` |
| D2-003 | `self-check/basic` false-positive on negated phrasing via substring match | MEDIUM | `builtins/self-check-basic.mjs:42` |
| D2-004 | Epsilon conditions receive no `namedArgs` — `${arg-name}` placeholders silently survive as literals | MEDIUM | `engine.ts:330` |
| D2-005 | Empty stdout produces opaque malformed-condition error with no caller guidance | LOW | `engine.ts:171` |
| D2-006 | spec-gate deferred issue #2 references non-existent tape-path heuristic in `validate-non-empty-args.mjs` | LOW | `docs/audit/Round2/spec-gate.md` |

---

## Findings

---

### D2-001 — `submit/required-fields` doc example omits `${$TAPE_FILE}`

**Severity:** HIGH

**Violated contract:**  
*Precondition* of `submit-required-fields.mjs`: `process.argv[process.argv.length - 1]` must be a valid filesystem path to the tape JSON file.  
*Postcondition* of `expandBuiltinCondition` (builtin-registry.ts:32 JSDoc): "pass `${$TAPE_FILE}` explicitly when the helper needs tape access."

**What the code does:**  
`submit-required-fields.mjs` unconditionally treats its last argv element as the tape path:

```js
// submit-required-fields.mjs:18-19
const tape_path = args[args.length - 1];
const fields = args.slice(0, args.length - 1);
```

There is no existence check before `readFileSync`, and no detection that the last arg is a field name rather than a path.

**Concrete counterexample:**  
`docs/builtin-procedures.md` shows this example for `submit/required-fields`:

```yaml
condition:
  builtin: submit/required-fields
  args: [PLAN_TEXT, CODE_WRITTEN, TESTS_PASSED]
```

Following this example literally, `expandBuiltinCondition` produces:

```
argv = [node, <script>, "PLAN_TEXT", "CODE_WRITTEN", "TESTS_PASSED"]
```

Inside the script: `tape_path = "TESTS_PASSED"`, `fields = ["PLAN_TEXT", "CODE_WRITTEN"]`.  
`readFileSync("TESTS_PASSED")` → `ENOENT: no such file or directory 'TESTS_PASSED'`.  
The condition returns `false` with `Could not read tape at "TESTS_PASSED": ENOENT …` — a confusing error giving no hint the configuration is wrong.

**Correct usage** (not shown in the doc):

```yaml
condition:
  builtin: submit/required-fields
  args: [PLAN_TEXT, CODE_WRITTEN, TESTS_PASSED, "${$TAPE_FILE}"]
```

**Affected file:line:**  
- `docs/builtin-procedures.md` — `submit/required-fields` example block  
- `builtins/submit-required-fields.mjs:18` — `tape_path = args[args.length - 1]`

---

### D2-002 — `self-check/basic` never evaluates rubric items

**Severity:** MEDIUM

**Violated contract:**  
*Postcondition* per `docs/builtin-procedures.md`: "Returns `true` if the agent's self-assessment passes every rubric item."  
The word "every" implies each rubric item is individually checked against the assessment.

**What the code does:**  
Rubric items are captured at line 32 but only echoed in the reason string — they never appear in any conditional logic:

```js
// self-check-basic.mjs:31-32
const assessment = allArgs[allArgs.length - 1];
const rubric = allArgs.slice(0, allArgs.length - 1);  // captured, never evaluated

// self-check-basic.mjs:42
const passed = SUCCESS_MARKERS.some(m => text === m || text.startsWith(m + " ") || ...);
// `rubric` does not appear in this expression
```

The `rubric` variable is only referenced at lines 45 and 49 to build a display string. The pass/fail decision is made solely by pattern-matching `assessment` against `SUCCESS_MARKERS`.

**Concrete counterexample:**  
Config:

```yaml
condition:
  builtin: self-check/basic
  args: ["all unit tests pass", "no TODOs remain", "PR description written"]
```

LLM supplies assessment: `"done"`.  
Result: `true`, reason: `"Self-check passed. Rubric: [all unit tests pass; no TODOs remain; PR description written]. Assessment: 'done'"`.  
The rubric items are printed but none were verified. A flow advances even when all three rubric items are unmet.

**Affected file:line:**  
`builtins/self-check-basic.mjs:32` (rubric captured), `builtins/self-check-basic.mjs:42` (rubric absent from decision)

---

### D2-003 — `self-check/basic` false-positive on negated phrasing via substring match

**Severity:** MEDIUM

**Violated contract:**  
*Postcondition*: the builtin must return `true` only when the LLM genuinely signals completion.  
*Invariant*: negating a success marker (e.g. "not done") must not trigger `true`.

**What the code does:**  
The branch `text.includes(" " + m)` matches any marker appearing as a substring anywhere in the text, including inside negations:

```js
// self-check-basic.mjs:42
const passed = SUCCESS_MARKERS.some(m =>
  text === m ||
  text.startsWith(m + " ") ||
  text.startsWith(m + ".") ||
  text.startsWith(m + ",") ||
  text.includes(" " + m)   // ← matches " done" inside "not done"
);
```

**Concrete counterexamples:**

| Assessment text | Matched marker | Returned |
|---|---|---|
| `"not done"` | `"done"` via `" done"` | `true` ❌ |
| `"not complete"` | `"complete"` via `" complete"` | `true` ❌ |
| `"task is not ok"` | `"ok"` via `" ok"` | `true` ❌ |
| `"I have not satisfied the requirements"` | `"satisfied"` via `" satisfied"` | `true` ❌ |

All four assessments express failure but the builtin returns `true`, causing the flow to advance incorrectly.

**Affected file:line:**  
`builtins/self-check-basic.mjs:42`

---

### D2-004 — Epsilon conditions receive no `namedArgs`; `${arg-name}` placeholders survive as literals

**Severity:** MEDIUM

**Violated contract:**  
*Precondition* of `interpolatePlaceholders` (engine.ts:37): all `${arg-name}` tokens in `cmd` and `args` are replaced with values from `namedArgs` before spawn.  
*Invariant* of `runCondition`: the spawned process never receives an unexpanded `${…}` token as an argv element.

**What the code does:**  
`chainEpsilon` calls `runCondition` with only 5 positional arguments, omitting the 6th (`namedArgs`):

```ts
// engine.ts:330
const res = await runCondition(act.condition, tapePath, [], cwd, runtime.flow_dir);
//                                                                                 ^ namedArgs absent → defaults to {}
```

`runCondition` signature:

```ts
// engine.ts:61,67
export async function runCondition(
  condition: Condition,
  tapePath: string,
  llmArgs: string[],
  cwd: string,
  flowDir: string,
  namedArgs: Record<string, string> = {},   // ← always {} for epsilon calls
```

`interpolatePlaceholders` (engine.ts:44) returns the original token unchanged when the key is absent from `namedArgs`:

```ts
return match;  // literal "${arg-name}" passed through unchanged
```

**Concrete counterexample:**  
An epsilon state with:

```yaml
condition:
  cmd: ./check.sh
  args: ["${user-input}"]
```

`chainEpsilon` spawns: `./check.sh '${user-input}'` — the literal string `${user-input}` reaches the child process as argv[1]. No error is raised; the condition silently runs with garbage input.

Builtin variant — also broken:

```yaml
condition:
  builtin: validate/non-empty-args
  args: ["${summary}"]
```

Spawns: `node validate-non-empty-args.mjs '${summary}'` — the string `"${summary}"` is non-empty, so the builtin returns `true` regardless of whether the LLM provided a summary.

**Affected file:line:**  
`engine.ts:330` (call site omits namedArgs), `engine.ts:44` (silent passthrough in interpolatePlaceholders)

---

### D2-005 — Empty stdout produces opaque malformed-condition error

**Severity:** LOW

**Violated contract:**  
*Postcondition* of `runCondition`: when a condition process exits without writing a valid first line, the caller receives `ok: false` with a `reason` that is actionable for debugging.  
The README does not define behaviour for empty stdout — a contract gap at the spec level.

**What the code does:**

```ts
// engine.ts:159-171
const lines = stdout.split("\n");
const first = (lines[0] ?? "").trim().toLowerCase();
// ...
// malformed branch:
reason: `Condition script exited with unexpected output: got '${first}'. ${exitStr}. stderr: ${stderr.trim() || "(none)"}`
```

When stdout is empty: `lines = [""]`, `first = ""` after trim, message becomes:

```
Condition script exited with unexpected output: got ''. Exit code 0. stderr: (none)
```

**Concrete counterexample:**  
A condition script that writes only to stderr and exits 0:

```sh
#!/bin/sh
echo "checking..." >&2
# forgot to write true/false to stdout
```

The developer sees `got ''` with no indication that the script simply forgot to write to stdout. The error does not distinguish "script crashed before writing" from "script intentionally wrote nothing".

**Affected file:line:**  
`engine.ts:171` (malformed branch reason string)

---

### D2-006 — spec-gate deferred issue #2 references non-existent tape-path heuristic

**Severity:** LOW

**Violated contract:**  
`docs/audit/Round2/spec-gate.md` deferred issue #2 states that `builtins/validate-non-empty-args.mjs:23-26` contains a "tape-path heuristic" that strips the first absolute-path arg when `needs_tape` is false, and classifies this as a known LOW-MEDIUM risk.

**What the code actually contains at lines 23-26:**

```js
// validate-non-empty-args.mjs:23-26
const emptyIndices = rawArgs
  .map((a, i) => ({ a, i }))
  .filter(({ a }) => !a || a.trim().length === 0)
  .map(({ i }) => i + 1);
```

There is no tape-path heuristic. The lines simply identify empty/whitespace args. The heuristic described in the deferred issue does not exist in the current source.

**Consequence:**  
The deferred issue tracks a bug in code that was either never written or was removed. A user arg that is a legitimate absolute path (e.g. `"/home/user/report.md"`) is correctly treated as non-empty and returns `true` — there is no stripping behaviour to cause a false negative. The spec-gate entry should be closed or revised to reflect the current code.

**Affected file:line:**  
`docs/audit/Round2/spec-gate.md` (deferred issue #2), `builtins/validate-non-empty-args.mjs:23-26`

---

## Contract Coverage Matrix

| Contract point | Audited | Status |
|---|---|---|
| stdout first line `true`/`false` (case-insensitive) | ✓ | Conformant — engine.ts:160 lowercases before compare |
| `"true"` without trailing newline | ✓ | Conformant — `split("\n")` yields `["true"]`, parses correctly |
| Empty stdout → `ok:false` | ✓ | Conformant (but opaque error — D2-005) |
| Whitespace-only stdout → `ok:false` | ✓ | Conformant — trim() collapses to `""` → malformed branch |
| Binary garbage stdout → `ok:false` | ✓ | Conformant — UTF-8 decoded; first line not `true`/`false` → malformed |
| 64 KiB stdout cap does not corrupt first-line parse | ✓ | Conformant — cap only appends suffix to `reason` |
| `submit/required-fields` tape-path precondition | ✗ | **D2-001** — doc example broken |
| `self-check/basic` rubric postcondition | ✗ | **D2-002** — rubric never evaluated |
| `self-check/basic` negation safety | ✗ | **D2-003** — substring match false-positive |
| Epsilon condition placeholder expansion | ✗ | **D2-004** — namedArgs not passed to chainEpsilon |
| `soft-review/claude` stub fails closed | ✓ | Conformant — documented intentional |
| `soft-review/pi` stub fails closed | ✓ | Conformant — documented intentional |
| Unknown builtin name → parse-time error | ✓ | Conformant — builtin-registry.ts:50-53 |
| `validate/non-empty-args` empty-arg detection | ✓ | Conformant |

---

## Recommended Fixes (non-normative)

**D2-001:** Add `"${$TAPE_FILE}"` as the last element in the `submit/required-fields` doc example. Optionally add a runtime guard in the script that checks `fs.existsSync(tape_path)` before `readFileSync`, emitting a clearer error when the arg is not a valid path.

**D2-002 + D2-003:** Replace the `SUCCESS_MARKERS` heuristic with whole-word boundary matching (`/\bdone\b/i`) and add a negation-prefix guard before declaring a match. Long-term, replace with an actual LLM rubric evaluator as the stub comment at line 13 already suggests.

**D2-004:** Either (a) thread `namedArgs` through `chainEpsilon` so epsilon conditions can use `${arg-name}` placeholders, or (b) document explicitly in `builtin-procedures.md` and the configuration tutorial that `${arg-name}` placeholders are not supported in epsilon-state conditions and will be passed as literal strings.

**D2-005:** Distinguish the empty-stdout case in the error message: `"Condition script produced no stdout. First line must be 'true' or 'false'."` and include the hint in the README contract section.

**D2-006:** Close or revise deferred issue #2 in `spec-gate.md` to reflect that the described heuristic is absent from the current source.
