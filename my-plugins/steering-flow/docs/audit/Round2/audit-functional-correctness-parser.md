# Hoare Audit — D1: Functional Correctness (Parser)

**Target:** `my-plugins/steering-flow/parser.ts`
**Spec baseline:** `docs/audit/Round2/spec-gate.md`
**Auditor:** Sisyphus-Junior
**Date:** 2026-04-23
**Round:** 2

---

## Audit Scope

Two mandated focus areas:

- **A** — Block-scalar chomp indicator handling (`|+`, `|-`, `>+`, `>-`)
- **B** — Quoted-string escape sequences in `parseScalar`

Plus any additional functional correctness issues discovered during full read.

---

## Findings

---

### D1-001 — Chomp indicators silently discarded; strip/keep semantics never applied

| Field | Value |
|---|---|
| **Severity** | DISPROVEN |
| **Affected file:line** | `parser.ts:512-513` (collapse), `parser.ts:535`, `parser.ts:549` (always-clip) |
| **Status** | Deferred from spec-gate.md — confirmed here as a concrete Pre/Post violation |

**Precondition (caller expects):**
`parseKeyValue` receives a line whose `rest` is one of `|-`, `|+`, `>-`, `>+`. The YAML spec defines three chomp modes: clip (default), strip (`-`), keep (`+`). The caller expects the returned block scalar value to honour the chomp indicator: strip removes all trailing newlines; keep preserves all trailing newlines; clip produces exactly one trailing newline.

**Postcondition (function actually delivers):**
Lines 512–513 map all four variants to the bare indicator (`"|"` or `">"`), discarding the suffix entirely. `readBlockScalar` is never told which chomp mode was requested. Lines 535 and 549 unconditionally append exactly one `"\n"` — clip behaviour — regardless of whether strip or keep was specified.

**Concrete counterexample:**

```yaml
# strip chomp — trailing newline must be absent
body: |-
  line one
  line two
```

Expected value: `"line one\nline two"` (no trailing newline — strip)
Actual value:   `"line one\nline two\n"` (trailing newline — clip)

```yaml
# keep chomp — all trailing blank lines must be preserved
body: |+
  line one

```

Expected value: `"line one\n\n"` (two newlines — keep)
Actual value:   `"line one\n"` (one newline — clip)

**Invariant violated:** `chomp(indicator) ∈ {strip, clip, keep}` — the indicator is a meaningful part of the scalar header and must survive into `readBlockScalar`.

---

### D1-002 — Double-quoted strings: escape sequences returned as literal backslash text

| Field | Value |
|---|---|
| **Severity** | VULNERABLE |
| **Affected file:line** | `parser.ts:558-559` |

**Precondition (caller expects):**
`parseScalar(s)` where `s` is a YAML double-quoted string (starts and ends with `"`). YAML 1.2 §7.3.1 mandates that double-quoted scalars process escape sequences: `\n` → U+000A, `\t` → U+0009, `\\` → U+005C, `\"` → U+0022, `\/` → U+002F, `\uXXXX` → the corresponding Unicode code point, etc.

**Postcondition (function actually delivers):**
`s.slice(1, -1)` — strips the surrounding quotes and returns the raw interior verbatim. No escape processing occurs. Every backslash sequence is returned as two literal characters.

**Concrete counterexample:**

```yaml
description: "step\ttabbed\nand newlined"
```

Expected value: `"step` + TAB + `tabbed` + LF + `and newlined"` (actual control characters)
Actual value:   `"step\ttabbed\nand newlined"` (literal backslash-t and backslash-n, 6 extra chars)

Additional cases that all silently misbehave:

| Input scalar | Expected | Actual |
|---|---|---|
| `"path\\to\\file"` | `path\to\file` | `path\\to\\file` |
| `"say \"hi\""` | `say "hi"` | `say \"hi\"` |
| `"caf\u00E9"` | `café` | `caf\u00E9` |

**Invariant violated:** `∀ escape ∈ YAML_ESCAPES: decode(escape) ≠ escape` — the decoded value must differ from the raw source text for any escape sequence.

---

### D1-003 — Single-quoted strings: `''` escape sequence not decoded

| Field | Value |
|---|---|
| **Severity** | VULNERABLE |
| **Affected file:line** | `parser.ts:558-559` |

**Precondition (caller expects):**
`parseScalar(s)` where `s` is a YAML single-quoted string. YAML single-quoted scalars have exactly one escape mechanism: `''` (two consecutive single quotes) represents a literal single-quote character.

**Postcondition (function actually delivers):**
`s.slice(1, -1)` returns the raw interior. The `''` sequence is returned as two literal single-quote characters.

**Concrete counterexample:**

```yaml
task_description: 'it''s done'
```

Expected value: `it's done` (7 chars)
Actual value:   `it''s done` (8 chars — two single quotes)

**Invariant violated:** `decode_single_quoted("''") = "'"` — the only escape in single-quoted mode is not applied.

---

### D1-004 — Unterminated double-quoted string: silent pass-through with leading quote in value

| Field | Value |
|---|---|
| **Severity** | VULNERABLE |
| **Affected file:line** | `parser.ts:553-565` |

**Precondition (caller expects):**
`parseScalar(s)` where `s` starts with `"` but has no closing `"` is a malformed YAML scalar. The precondition of the quoted-string branch is `s.startsWith('"') && s.endsWith('"')`. If that precondition is not met, the input is invalid and a `ParseError` should be raised — consistent with the tab-rejection and depth-limit guards elsewhere in the parser.

**Postcondition (function actually delivers):**
The quoted-string branch is not entered (condition false). The number branch is not entered (NaN). The function falls through to `return s`, returning the raw string including the leading `"` character. No error is raised.

**Concrete counterexample:**

```yaml
state_desc: "unclosed
```

Expected behaviour: `ParseError` — unterminated quoted scalar
Actual behaviour:   value is the string `"unclosed` (9 chars, leading quote included), silently accepted

Particularly dangerous for `action_desc` or any free-text field not subsequently validated by `IDENT_RE` — the corrupt value propagates into the FSM definition undetected.

**Invariant violated:** `parseScalar` must be total over well-formed inputs and partial (error) over malformed ones. Unterminated quotes are malformed; the function must not silently succeed.

---

### D1-005 — Mismatched quotes: silent pass-through as raw string

| Field | Value |
|---|---|
| **Severity** | VULNERABLE |
| **Affected file:line** | `parser.ts:553-565` |

**Precondition (caller expects):**
A scalar like `'hello"` (opens with single quote, closes with double quote) is malformed YAML and should be rejected.

**Postcondition (function actually delivers):**
Neither quoted branch matches (`startsWith("'") && endsWith("'")` is false; `startsWith('"') && endsWith('"')` is false). Falls through to `return s`. The raw string `'hello"` is returned silently.

**Concrete counterexample:**

```yaml
action_id: 'my-action"
```

Expected behaviour: `ParseError` — mismatched quote delimiters
Actual behaviour:   value is `'my-action"` — `IDENT_RE` will reject it for `action_id`/`state_id` fields, but for free-text fields the corrupt value passes through entirely.

**Invariant violated:** Same as D1-004 — malformed scalars must not silently succeed.

---

### D1-006 — Block-mapping list item on continuation lines silently dropped

| Field | Value |
|---|---|
| **Severity** | DISPROVEN |
| **Affected file:line** | `parser.ts:389` (array item detection), `parser.ts:454` (array loop push) |

**Precondition (caller expects):**
A YAML sequence item where the dash line carries no inline value and the item's content begins on the next indented line:

```yaml
actions:
  -
    action_id: go
    next_state: END
```

The caller expects the item to be parsed as the object `{ action_id: "go", next_state: "END" }`.

**Postcondition (function actually delivers):**
Line 389: `trimmed.startsWith("- ")` requires a space after the dash. A bare `-` line does not match this branch at all — it falls to the key-value branch, `colonIdx` is `-1`, and the line is silently skipped. The continuation lines at deeper indent are then encountered with `indent !== baseIndent`, causing a `break`. The entire item is lost.

Even in the `"- "` (dash-space) variant: `afterDash` is `""`, `parseScalar("")` returns `""` (see D1-007), the item is pushed as `""`, and the deeper-indented continuation lines still cause a `break` — sub-object silently dropped.

**Concrete counterexample:**

```yaml
states:
  - state_id: INIT
    actions:
      -
        action_id: go
        next_state: END
```

Expected: `actions` array contains `{ action_id: "go", next_state: "END" }`
Actual: `actions` array is empty (bare `-` line skipped entirely)

**Invariant violated:** `parseYamlArray` must parse block-mapping items whose content starts on the line after the dash. The postcondition `result[i] = parse(item_content)` is violated when item content is on continuation lines.

---

### D1-007 — `parseScalar("")` returns `""` instead of `null`

| Field | Value |
|---|---|
| **Severity** | PARTIAL |
| **Affected file:line** | `parser.ts:563` |

**Precondition (caller expects):**
YAML 1.2 §10.3 specifies that an empty scalar represents `null`. Any caller passing `""` to `parseScalar` expects `null` back, consistent with how downstream validation treats absent optional fields.

**Postcondition (function actually delivers):**
Line 563: `const n = Number(""); !isNaN(n) && s !== ""` — `Number("")` is `0`, `!isNaN(0)` is `true`, but `"" !== ""` is `false`, so the number branch is skipped. Falls through to `return s`, returning `""`.

**Concrete counterexample:**

```yaml
optional_hint:
```

Expected: `optional_hint` field value is `null`
Actual: `optional_hint` field value is `""` (empty string)

PARTIAL rather than VULNERABLE because downstream truthiness checks treat `""` and `null` equivalently for required-field guards. However, any optional field tested with `=== null` or `!== undefined` will behave incorrectly.

**Invariant violated:** `parseScalar("") = null` per YAML 1.2 §10.3.

---

### D1-008 — Bare `-` null list items (no trailing space) silently dropped

| Field | Value |
|---|---|
| **Severity** | PARTIAL |
| **Affected file:line** | `parser.ts:389` |

**Precondition (caller expects):**
YAML allows both `- value` and a bare `-` (followed immediately by newline) as sequence entries, the latter representing a null-value item. The array parser should recognise both forms.

**Postcondition (function actually delivers):**
Line 389: `trimmed.startsWith("- ")` requires a trailing space. A line that trims to exactly `"-"` does not match. It falls to the key-value branch, `colonIdx` is `-1`, and the line is silently skipped.

**Concrete counterexample:**

```yaml
tags:
  -
  - foo
  -
```

Expected: `[null, "foo", null]`
Actual: `["foo"]` — the two bare `-` lines are silently dropped

**Invariant violated:** `parseYamlArray` must handle all valid YAML sequence entry forms, including bare `-` null entries.

---

## Summary Table

| ID | Area | Severity | File:Line | Description |
|---|---|---|---|---|
| D1-001 | Chomp indicators | DISPROVEN | `parser.ts:512-513,535,549` | `\|-`/`\|+`/`>-`/`>+` collapsed to `\|`/`>`; always-clip applied |
| D1-002 | Double-quoted escapes | VULNERABLE | `parser.ts:558-559` | No escape processing; `\n`, `\t`, `\\`, `\"`, `\uXXXX` returned as literals |
| D1-003 | Single-quoted `''` escape | VULNERABLE | `parser.ts:558-559` | `''` not decoded to `'` |
| D1-004 | Unterminated double-quote | VULNERABLE | `parser.ts:553-565` | Silent pass-through with leading `"` in value |
| D1-005 | Mismatched quotes | VULNERABLE | `parser.ts:553-565` | Silent pass-through as raw string |
| D1-006 | Continuation-line item drop | DISPROVEN | `parser.ts:389,454` | Block-mapping item on lines after dash silently dropped |
| D1-007 | Empty scalar not null | PARTIAL | `parser.ts:563` | `parseScalar("") = ""` not `null` |
| D1-008 | Bare `-` null items | PARTIAL | `parser.ts:389` | `startsWith("- ")` misses `-\n` null entries |

---

## Notes on Intentional Omissions (not reported)

Per `spec-gate.md` the following are explicitly accepted and excluded from findings:

- Structural-only reachability (no semantic reachability check)
- Conditions not enforced as idempotent
- In-process mutex only (no cross-process locking)
- Windows path caveats
- LLM tape jitter accepted

Deferred issues #2–#4 from spec-gate.md (`validate-non-empty-args` heuristic, `renderTransitionResult` hint, `loadRuntime` CWD) are outside parser scope and not re-reported here.
