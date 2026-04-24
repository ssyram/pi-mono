# Round 3 Verification — self-check-basic.mjs

Date: 2026-04-24

## D1-003: Negation lookbehind handles multiple spaces

**Fix location:** line 48–49

```js
const pre = text.slice(Math.max(0, match.index - 10), match.index);
if (/\bnot\s+$/.test(pre) || /\bno\s+$/.test(pre)) return false;
```

| Test case | Expected | Result |
|---|---|---|
| `"done"` alone | match (positive) | ✅ no negation prefix → `isMarkerPositive` returns `true` |
| `"not done"` | no match (negated) | ✅ `pre = "not "` → `/\bnot\s+$/` matches → returns `false` |
| `"not  done"` (two spaces) | no match (negated) | ✅ `pre = "not  "` → `\s+` matches one-or-more spaces → returns `false` |

**PASS** — `\s+` correctly handles any number of spaces between negation word and marker.

---

## D1-004: Rubric matching uses word boundaries

**Fix location:** line 55

```js
return new RegExp(`\\b${escapeRegex(term)}\\b`).test(text);
```

| Test case | Expected | Result |
|---|---|---|
| `"ok"` in `"book"` | no match | ✅ `\bok\b` does not match inside `"book"` (surrounded by word chars) |
| `"ok"` alone | match | ✅ `\bok\b` matches standalone `"ok"` |
| `"it's ok now"` | match | ✅ `\bok\b` matches `ok` bounded by space/apostrophe context |

**PASS** — word boundaries prevent substring false positives.

---

## stdout protocol

First output line is always `console.log("true")` or `console.log("false")` (lines 60–68). No code path emits output before this. Protocol intact.

**PASS**

---

## Regressions

- Empty-args guard: present (exits early if `allArgs.length < 1`)
- Empty-assessment guard: present
- Rubric-length-0 shortcut: present (skips rubric check when no rubric items)
- `escapeRegex` applied before building rubric regex: confirmed (line 55)

**No regressions detected.**

---

## Summary

| Fix | Status |
|---|---|
| D1-003 multi-space negation | ✅ PASS |
| D1-004 word-boundary rubric match | ✅ PASS |
| stdout protocol | ✅ PASS |
| Regressions | ✅ NONE |
