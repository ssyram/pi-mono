# Builtins & Docs Verification — Round 2

**Date**: 2026-04-23  
**Scope**: NDA-01 (doc example), NDA-02 (rubric wiring), NDA-03 (negation false-positive)  
**Files inspected**:
- `docs/builtin-procedures.md`
- `builtins/submit-required-fields.mjs`
- `builtins/self-check-basic.mjs`
- `builtin-registry.ts`

---

## NDA-01 — Doc example matches `submit/required-fields` arg contract

**Claim**: The doc example for `submit/required-fields` now correctly shows tape path as the last argument, with field names preceding it.

**Actual script contract** (`submit-required-fields.mjs`):
```
argv: FIELD1 [FIELD2 ...] TAPE_PATH
```
Script reads: `tape_path = args[args.length - 1]`, `fields = args.slice(0, args.length - 1)`.

**Doc example** (`docs/builtin-procedures.md`, `### \`submit/required-fields\`` section):
```yaml
condition:
  builtin: submit/required-fields
  args: [PLAN_TEXT, CODE_WRITTEN, TESTS_PASSED, "${$TAPE_FILE}"]
```

**Analysis**: `${$TAPE_FILE}` is the last element; `PLAN_TEXT`, `CODE_WRITTEN`, `TESTS_PASSED` are field names preceding it. This exactly matches the script's positional contract. The doc also states: _"`${$TAPE_FILE}` must be the last argument — the script reads it as the tape path."_

The intro section example and the epsilon-router usage example (`args: [PLAN_TEXT, CODE_WRITTEN, "${$TAPE_FILE}"]`) also follow the same pattern correctly.

**Verdict**: ✅ PASS

---

## NDA-02 — Rubric items wired into pass/fail decision

**Claim**: `self-check-basic.mjs` now uses rubric items to gate the pass/fail result (previously rubric items were parsed but ignored).

**Evidence** (`self-check-basic.mjs`, lines 44–46):
```js
// NDA-02: if rubric items were supplied, every item must appear in the assessment text.
const rubricSatisfied = rubric.length === 0 || rubric.every(item => text.includes(item.trim().toLowerCase()));
const passed = markerFound && rubricSatisfied;
```

**Analysis**:
- `rubric` = all args except the last (which is the LLM self-assessment).
- `rubricSatisfied` is `true` only when **every** rubric item appears (case-insensitively) in the assessment text, or no rubric items were provided.
- `passed` is gated on **both** `markerFound` AND `rubricSatisfied` — a positive success marker alone is no longer sufficient if rubric items are missing from the assessment.
- Rubric items are also surfaced in the reason line for traceability: `Rubric: [${rubric.join("; ")}]`.

Before this fix, `passed` depended only on `markerFound`; rubric items were silently unused. Now they form a hard gate.

**Verdict**: ✅ PASS

---

## NDA-03 — Negation false-positive fixed (`"not done"` no longer triggers a match)

**Claim**: The success-marker regex now uses negative lookbehind so that negated phrases like `"not done"` or `"no done"` do not trigger a positive match for the marker `"done"`.

**Evidence** (`self-check-basic.mjs`, lines 42–43):
```js
// NDA-03: use negative lookbehind to avoid matching markers inside negated phrases (e.g. "not done").
const markerFound = SUCCESS_MARKERS.some(m => new RegExp(`(?<!not\s)(?<!no\s)\b${m}\b`).test(text));
```

**Analysis**:
- The pattern `(?<!not\s)(?<!no\s)\b${m}\b` prevents a match if the marker is immediately preceded by `"not "` or `"no "`.
- `"not done"` → the position before `"done"` is preceded by `"not "` → lookbehind fires → **no match**. ✅
- `"task is done"` → not preceded by `"not "` or `"no "` → **match**. ✅
- Word-boundary `\b` ensures `"undone"` or `"completed"` (partial) are not affected by the fix.

**Verdict**: ✅ PASS

---

## Bonus check — stdout protocol compliance (`self-check-basic.mjs`)

All exit paths emit `true` or `false` as the **first** `console.log` call, followed by a reason string on subsequent lines:

| Exit path | First line | Second line |
|---|---|---|
| No args | `false` | usage message |
| Empty assessment | `false` | error message |
| `passed === true` | `true` | reason |
| `passed === false` | `false` | reason |

**Verdict**: ✅ Protocol compliant

---

## Summary

| Fix | Description | Verdict |
|---|---|---|
| NDA-01 | Doc example matches `submit/required-fields` arg contract | ✅ PASS |
| NDA-02 | Rubric items wired into pass/fail gate | ✅ PASS |
| NDA-03 | Negation false-positive eliminated via lookbehind regex | ✅ PASS |
| Bonus | `self-check-basic` stdout protocol (first line true/false) | ✅ PASS |

All three fixes verified. No regressions observed.
