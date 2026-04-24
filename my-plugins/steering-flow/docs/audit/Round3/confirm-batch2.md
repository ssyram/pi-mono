# Hoare Audit — Batch 2 Independent Confirmation

**Reviewer**: Fresh independent reviewer (no prior audit context read)  
**Date**: 2026-04-24  
**Source root**: `my-plugins/steering-flow/`  
**Method**: Direct code reading — `index.ts`, `stop-guards.ts`, `types.ts`  
**Audit docs read**: None (per task rules)

---

## D2-001 (HIGH) — Optional-chaining `?.` at line end triggers `isAskingQuestion`

**Claim**: `text.trim().endsWith("?")` is the detection predicate. Optional-chaining syntax `foo?.bar` at the end of a code block in the LLM response would produce a trailing `?`, causing a false positive that skips re-injection when it shouldn't.

### Evidence

`stop-guards.ts` lines 30–36 (full `isAskingQuestion` implementation):

```typescript
const text = last.content
    .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
if (text.trim().endsWith("?")) return true;
```

The predicate is `text.trim().endsWith("?")` — a raw string suffix check on the entire concatenated text content of the last assistant message. There is no code-block stripping, no fenced-block awareness, and no context sensitivity.

### Assessment: **CONFIRMED**

If the LLM response ends with any token that is literally the character `?` — including:

- `foo?.bar` (optional chaining)
- `obj?.method()` (optional method call — ends with `)` not `?`, so this specific variant is safe)
- A ternary expression like `x ? y : z` mid-block, **only** if the block itself ends with a standalone `?` on the last trimmed character

The most direct reproducing case is a code block whose last non-whitespace character is `?`, such as:

````
Here is an example:
```
const x = foo?.bar
```
````

After `trim()`, the full text ends in `bar` — safe in this case. But:

````
```
const val = maybe?
```
````

…ends with `?` after trim → false positive. Similarly a TypeScript type assertion context or a line like `return obj?.` (incomplete, at stream cut) would trigger it. The `.trim().endsWith("?")` heuristic has no fencing awareness.

**Severity retained: HIGH.** The stop hook is a correctness-critical path — a false positive here means the agent silently fails to re-inject the steering prompt.

---

## D2-002 (MEDIUM) — URLs with query strings trigger `isAskingQuestion`

**Claim**: A URL like `https://example.com/path?key=val` at end of response ends with a non-`?` character (`l`), so the claim requires the URL to end with a bare `?`. More precisely the concern is `https://example.com/search?` — a URL whose query string marker is the last character.

### Evidence

Same predicate: `text.trim().endsWith("?")` in `stop-guards.ts`.

### Assessment: **CONFIRMED (with scope clarification)**

A URL ending exactly with `?` (e.g., a URL with an empty query string, or a URL that was truncated at the `?` separator) would trigger the predicate. A URL like `https://example.com/path?key=val` does **not** end with `?` and is safe.

However, the realistic case the finding is pointing at — a response body that includes a URL reference and ends with a `?` from that URL — does occur in practice:

- Markdown links: `` [link](https://api.example.com/endpoint?) `` — ends with `)`, safe.
- Bare URL at end of line: `https://example.com/search?` → ends with `?` → triggers.
- API documentation responses listing endpoints: `GET /users?` → triggers.

The finding is **confirmed** as stated, though the realistic trigger is narrower than a generic "URLs with query strings." Any response whose last non-whitespace character is `?` for a non-question reason triggers the false positive.

**Severity retained: MEDIUM.** Less common than the optional-chaining case but plausible in API-focused flows.

---

## D2-003 (MEDIUM) — Code blocks with trailing `?` trigger question detection

**Claim**: A ternary operator or other `?`-bearing syntax at the end of a fenced code block causes `isAskingQuestion` to return `true`. There is no code-block-aware filtering.

### Evidence

`stop-guards.ts`:
- Text is assembled by joining all `type === "text"` content blocks with `""`.
- `text.trim().endsWith("?")` is applied to the raw joined string.
- No stripping of ` ```...``` ` fenced blocks. No regex to detect and exclude code regions.

There is a secondary check — `last.content.some((c) => c.type === "toolCall" && c.name === "question")` — but this is additive (OR), not a replacement for the text check.

### Assessment: **CONFIRMED**

There is zero code-block awareness. A response like:

````
Here's a ternary expression:
```typescript
const result = condition ? valueA : valueB?
```
````

…after `trim()` ends in `?` and returns `true`. Same applies to:

- Nullish coalescing: `value ?? fallback?` as last line
- Any TypeScript construct ending in `?` (optional property, nullable type annotation `string?`)

The finding is fully confirmed. No filtering, no parsing, no fence detection exists in the implementation.

**Severity retained: MEDIUM.** Overlaps mechanically with D2-001; both are the same root cause (naive `endsWith("?")`), just different surface-syntax triggers.

---

## D2-004 (HIGH) — `CONFIRM_STOP_TAG` inside markdown code block still triggers stop

**Claim**: The stop-tag detection uses `.includes()` on raw text, so the tag embedded inside a fenced code block in the response is indistinguishable from a genuine intent-to-stop signal.

### Evidence

`index.ts` line 49:
```typescript
const CONFIRM_STOP_TAG = "<STEERING-FLOW-CONFIRM-STOP/>";
```

`index.ts` line 671 (agent_end hook):
```typescript
if (last && last.content.some((c) => c.type === "text" && c.text.includes(CONFIRM_STOP_TAG))) return;
```

The detection is a plain substring search (`String.prototype.includes`) over the raw text content. No structure is parsed. No code-block boundaries are checked.

### Assessment: **CONFIRMED**

If the LLM produces a response like:

````
To stop the flow, output the following tag:
```
<STEERING-FLOW-CONFIRM-STOP/>
```
````

…`c.text.includes(CONFIRM_STOP_TAG)` returns `true`, the guard fires, and the re-injection is skipped — even though the LLM was merely explaining the tag, not invoking it.

This is a **genuine correctness defect** in the critical stop-hook path. A false positive here causes the steering flow to silently not re-prompt the agent, breaking the flow contract. The LLM could trigger this inadvertently by:

- Quoting the tag in documentation
- Showing it in an example
- Having it appear in a code review or diff context

**Severity retained: HIGH.** Unambiguous false-positive vector on a correctness-critical guard.

---

## D2-005 (MEDIUM) — `stableStringify` maps both `undefined` and `null` to `"null"`

**Claim**: The stagnation hash is built from `stableStringify(rt.tape)`. The function maps `undefined → "null"` and `null → JSON.stringify(null) → "null"`. If a tape key holds `undefined` vs `null`, both produce the same serialised form, making two semantically distinct tape states hash identically.

### Evidence

`index.ts` lines 91–96 (`stableStringify`):
```typescript
function stableStringify(v: unknown): string {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
}
```

- Line 92: `undefined → "null"` (literal)
- Line 93: `null → JSON.stringify(null)` → `"null"` (same literal)

Code-level collision confirmed.

`index.ts` line 704:
```typescript
.update(rt.current_state_id + "\0" + stableStringify(rt.tape))
```

### Reachability Analysis

`types.ts` defines:
```typescript
type TapeValue = string | number | boolean | null | TapeValue[] | { [key: string]: TapeValue };
```

`TapeValue` does **not** include `undefined`. The `tape` field is typed as `Record<string, TapeValue>`.

Additionally, tape is persisted to disk and loaded via `JSON.parse`. `JSON.parse` never produces `undefined` values for object properties — it silently omits keys with `undefined` values in `JSON.stringify` (though parsing cannot introduce them).

**Therefore:** The `v === undefined` branch of `stableStringify` is **type-unreachable** for any value that originates from the tape. The collision between `undefined` and `null` cannot occur in practice for `stableStringify(rt.tape)`.

### Assessment: **REJECTED**

The code-level defect is real — the function is incorrectly written if used with `unknown` inputs that include `undefined`. However, as applied to `rt.tape`:

1. `TapeValue` excludes `undefined` by type definition.
2. JSON round-trip cannot introduce `undefined`.
3. No in-memory code path assigns `undefined` to a tape key.

The stagnation hash collision between `null` and `undefined` tape values cannot be triggered through any reachable execution path. The finding should be downgraded from MEDIUM to **informational / defensive** — the fix (distinguishing `undefined` from `null` in `stableStringify`) is still advisable for correctness hygiene if the function is ever reused for other inputs, but it does not represent an actual bug in the stagnation detection logic today.

---

## Summary Table

| ID | Severity (Claimed) | Verdict | Notes |
|---|---|---|---|
| D2-001 | HIGH | **CONFIRMED** | `endsWith("?")` has no code-block awareness; optional chaining, bare `?` tokens trigger false positives |
| D2-002 | MEDIUM | **CONFIRMED** (narrowed) | Only URLs ending literally with `?` trigger; realistic but narrower than stated |
| D2-003 | MEDIUM | **CONFIRMED** | Same root cause as D2-001; any trailing `?` in code block content triggers |
| D2-004 | HIGH | **CONFIRMED** | `.includes()` on raw text; tag in fenced code block indistinguishable from genuine stop |
| D2-005 | MEDIUM | **REJECTED** | Code defect real but unreachable: `TapeValue` excludes `undefined`; JSON round-trip cannot introduce it |

### Root-Cause Grouping

- **D2-001, D2-002, D2-003** share one root cause: `text.trim().endsWith("?")` in `stop-guards.ts:isAskingQuestion` — no structural awareness of the response. One fix (strip fenced code blocks before the check) would address all three.
- **D2-004** is a separate root cause: substring search for a control tag with no structure parsing. Fix: require the tag to appear outside fenced code blocks (regex with negative lookbehind or structured content extraction).
- **D2-005** is a defensive code quality issue, not a live bug.
