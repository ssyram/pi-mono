# Audit Batch 2 — Independent Verification
**Reviewer**: Fresh pass, source-only  
**Date**: 2026-04-23  
**Scope**: D1-005, D1-006, D1-007, D1-008 — `parser.ts`

---

## D1-005 — Mismatched quotes silently accepted

**Claim**: `parseScalar` accepts `'hello"` without error.

**Verdict**: CONFIRMED-solid-rationale

**Evidence** (`parser.ts` ~553–560):

```ts
if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
}
```

The quoted-string branch requires both delimiters to match. `'hello"` starts with `'` but ends with `"` — both conditions fail. Execution falls through to:
1. Number check: `Number("'hello\"")` → NaN, skipped
2. JSON flow check: doesn't start with `[` or `{`, skipped
3. Final fallthrough: `return s` — returns the literal string `'hello"` with no error

**Impact for steering-flow**: FSM config files use quoted strings for state names, action labels, and condition expressions. A typo like `'goto_state"` would silently parse as the raw string `'goto_state"` (including the quote characters), producing a state key that will never match any defined state — silent logic failure, no parse-time error.

---

## D1-006 — Continuation lines after bare `-` silently dropped

**Claim**: Block-mapping list items with continuation lines after bare `-` are silently dropped.

**Verdict**: CONFIRMED-solid-rationale (mechanism clarified)

**Evidence** (`parser.ts` ~402–455):

The array loop entry condition is:
```ts
if (!trimmed.startsWith("- ")) break;
```

This requires `"- "` (dash + space). A bare `-` (no trailing space, `trimmed === "-"`) fails this check immediately and **breaks the loop**, terminating array parsing at that point. Any continuation lines that follow are never consumed.

For `"- "` (dash-space with nothing after), `afterDash = trimmed.slice(2).trim()` yields `""`. This hits the simple-item branch:
```ts
result.push(parseScalar(afterDash)); i++;
```
The outer loop then advances to the continuation line. That line has deeper indentation but does not start with `"- "`, so the loop breaks — continuation data is lost.

**Mechanism correction**: The finding says "silently dropped" — more precisely, bare `-` terminates the array loop entirely (subsequent items also lost), while `"- "` with continuation loses only the continuation text. Both are data-loss bugs.

**Impact for steering-flow**: Null/empty list entries and multi-line list values in FSM configs will be silently truncated or cause premature array termination.

---

## D1-007 — `parseScalar("")` returns `""` instead of `null`

**Claim**: Empty scalar returns `""` instead of `null`. YAML spec: empty value = null.

**Verdict**: CONFIRMED-solid-rationale

**Evidence** (`parser.ts` ~552–574):

```ts
function parseScalar(s: string): unknown {
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~") return null;
    if ((s.startsWith('"') && s.endsWith('"')) || ...) return s.slice(1, -1);
    const n = Number(s);
    if (!isNaN(n) && s !== "") return n;   // s !== "" guard explicitly skips empty
    if (s.startsWith("[") || s.startsWith("{")) { ... }
    return s;   // returns "" for empty input
}
```

`""` is not `"true"`, `"false"`, `"null"`, or `"~"`. The number guard explicitly excludes `""` via `s !== ""`. No other branch matches. Returns `""`.

**Downstream null-vs-empty impact**: `TapeValue` in `types.ts:67` includes `null` as a valid type. `index.ts:90` has null-aware output formatting (`if (v === null || typeof v !== "object") return JSON.stringify(v)`). However, no consumer code currently distinguishes `null` from `""` on values originating from YAML scalar parsing.

**Impact classification**: Type-contract violation (spec non-compliance) with **no currently observable behavioral difference** in steering-flow's FSM config usage. Risk is latent — any future code that checks `=== null` to detect omitted optional fields will silently misbehave.

---

## D1-008 — Bare `-` null list items silently dropped

**Claim**: Bare `-` (null list items) in `parseYamlArray` are silently dropped instead of producing `null` entries.

**Verdict**: CONFIRMED-solid-rationale (mechanism clarified — worse than claimed)

**Evidence** (`parser.ts` ~402`):

```ts
if (!trimmed.startsWith("- ")) break;
```

A bare `-` (`trimmed === "-"`) fails `startsWith("- ")` → **loop breaks**. This does not merely drop the null item — it terminates the entire array at that point. All subsequent list items are also lost.

The finding says "silently dropped" implying the item is skipped and parsing continues. The actual behavior is more severe: the array is truncated at the first bare `-`.

For `"- "` (dash-space, nothing after): `afterDash = ""` → `parseScalar("")` → `""` is pushed (see D1-007). So even the dash-space variant produces `""` rather than `null`, violating the YAML spec.

**Two distinct sub-cases**:

| Input | Behavior | Expected (YAML spec) |
|---|---|---|
| `"-"` (no space) | Breaks array loop — all remaining items lost | `null` entry, parsing continues |
| `"- "` (dash-space) | Pushes `""` | `null` entry |

**Impact for steering-flow**: FSM configs are unlikely to intentionally use null list items, so this is low practical risk. However, the loop-break behavior means a single malformed `-` in a list silently truncates the rest of the list — a harder-to-diagnose data loss than a simple null substitution.

---

## Summary Table

| ID | Verdict | Core Issue | Practical Risk |
|---|---|---|---|
| D1-005 | CONFIRMED-solid-rationale | Mismatched quotes return raw string with quote chars | Medium — silent state-key corruption |
| D1-006 | CONFIRMED-solid-rationale | Bare `-` breaks array loop; `"- "` loses continuation | Medium — data truncation in lists |
| D1-007 | CONFIRMED-solid-rationale | `parseScalar("")` returns `""` not `null` | Low-latent — spec violation, no current behavioral impact |
| D1-008 | CONFIRMED-solid-rationale | Bare `-` terminates array (not just drops item); `"- "` yields `""` not `null` | Low-medium — loop-break is worse than claimed |

**Mechanism note on D1-006 and D1-008**: Both findings describe the symptom correctly but understate severity. The loop-break on bare `-` loses not just the null item but all subsequent array items. The audit should reflect this distinction.
