# Round 4 Regression Audit: Visualizer & Builtins

**Audit Date**: 2026-04-24  
**Scope**: Round 3 changes to `visualizer/create-artifact.ts`, `visualizer/label-layout.ts`, `visualizer/document.ts`, `builtins/self-check-basic.mjs`

---

## Executive Summary

**Total Findings**: 5 (3 Medium, 2 Low)

Round 3 changes introduced 3 medium-severity regressions and 2 low-severity edge cases. The path containment fix (RC-C) has symlink and trailing-slash vulnerabilities. The warning mechanism (DA-R3-05/06) is architecturally broken — `console.warn` in `document.ts` has no access to `ctx.ui.notify` and may be suppressed by the plugin runner. The self-check rubric matcher (D1-004) has word-boundary false negatives for non-word-char rubric items.

---

## Findings

### R4-V-001: RC-C Path Containment — Symlink Escape Vulnerability

**Severity**: Medium  
**Location**: `visualizer/create-artifact.ts:17`, `visualizer/create-artifact.ts:32`  
**Violated Invariant**: RC-C (output path must be contained within cwd)

**Issue**:  
The path containment check uses `resolve()` which does NOT dereference symlinks. A symlink inside `cwd` pointing to a path outside `cwd` would pass the `startsWith(cwd + sep)` check but write outside the intended boundary.

**Counterexample**:
```bash
cwd = /project
outputFile = symlink-to-tmp  # symlink -> /tmp/evil.html
resolved = /project/symlink-to-tmp  # passes startsWith check
# But writeFile follows the symlink and writes to /tmp/evil.html
```

**Precondition Violated**: `resolve(cwd, outputFile)` must return a real path within `cwd`  
**Postcondition Violated**: `writeFile(outputPath, ...)` writes outside `cwd`

**Fix**: Use `realpath()` or `fs.realpathSync()` before the containment check to dereference symlinks.

---

### R4-V-002: RC-C Path Containment — Trailing Slash Edge Case

**Severity**: Low  
**Location**: `visualizer/create-artifact.ts:17`, `visualizer/create-artifact.ts:32`  
**Violated Invariant**: RC-C (output path must be contained within cwd)

**Issue**:  
If `cwd` itself has a trailing slash (e.g., `/project/`), then `cwd + sep` becomes `/project//` which would fail to match any real child path like `/project/out.html`.

**Counterexample**:
```javascript
cwd = "/project/"  // trailing slash
outputFile = "out.html"
resolved = "/project/out.html"
cwd + sep = "/project//"
resolved.startsWith("/project//") === false  // FAIL
```

**Precondition Violated**: `cwd` must be normalized (no trailing slash)  
**Postcondition Violated**: Valid child paths are rejected

**Fix**: Normalize `cwd` with `resolve(cwd)` or strip trailing slashes before concatenation.

---

### R4-V-003: DA-R3-05/06 Warning Mechanism — No User Visibility

**Severity**: Medium  
**Location**: `visualizer/document.ts:41`, `visualizer/document.ts:52`, `visualizer/document.ts:79`  
**Violated Postcondition**: DA-R3-05 (user is warned when FSM fails to load), DA-R3-06 (user is warned when FSM has no states)

**Issue**:  
`document.ts` uses `console.warn` but has no access to `ctx` (not threaded through from `index.ts:471` → `createVisualizerArtifact` → `buildSessionVisualizerDocument`). The pi plugin runner may suppress stderr from plugin module code, causing warnings to be silently dropped.

**Architectural Gap**:
- `index.ts:471` (visualizer tool handler) has `ctx` available
- `createVisualizerArtifact` does not accept or return warnings
- `document.ts` functions have no `ctx` parameter
- Other tool handlers in `index.ts` (lines 522, 527, 530, 542, 545) successfully use `ctx.ui.notify`

**Counterexample**:
```javascript
// User runs visualizer tool
// FSM "broken-fsm" fails to load
// console.warn fires in document.ts:41
// pi plugin runner suppresses stderr
// User sees no warning, visualization silently skips FSM
```

**Precondition Violated**: `ctx.ui.notify` must be available for user-facing warnings  
**Postcondition Violated**: User is not notified of skipped FSMs or empty states

**Fix**: Thread `ctx` through to `document.ts` functions, or return warnings from `createVisualizerArtifact` and emit via `ctx.ui.notify` in the tool handler.

---

### R4-V-004: D1-004 Rubric Matcher — Word Boundary False Negatives

**Severity**: Medium  
**Location**: `builtins/self-check-basic.mjs:43`, `builtins/self-check-basic.mjs:55`  
**Violated Postcondition**: D1-004 (rubric items with regex-special chars are matched literally)

**Issue**:  
The `escapeRegex` function correctly escapes special chars, but the `\b` word boundary in `\\b${escapeRegex(term)}\\b` causes false negatives for rubric items starting or ending with non-word chars. After escaping, `(ok)` becomes `\(ok\)`, and the pattern `\b\(ok\)\b` requires a word char before `(` — but `(` is a non-word char, so `\b` matches between word and non-word. If the text has `"(ok)"` preceded by a space (non-word), the leading `\b` fails to match.

**Counterexample**:
```javascript
rubric = ["(ok)"]
assessment = "The result is (ok) and verified."
escapeRegex("(ok)") = "\\(ok\\)"
pattern = /\b\(ok\)\b/
// \b before \( requires word char before (
// Space before ( is non-word, so \b matches
// But \b after \) requires non-word char after )
// Space after ) is non-word, so \b matches
// ACTUALLY: \b matches word/non-word boundary
// Space + ( = non-word + non-word = NO boundary
// FALSE NEGATIVE
```

**Precondition Violated**: Rubric items with leading/trailing non-word chars must match  
**Postcondition Violated**: `rubricSatisfied` returns false for valid matches

**Fix**: Remove `\b` boundaries when the escaped term starts/ends with non-word chars, or use a different boundary strategy (e.g., `(?<!\w)` and `(?!\w)` lookarounds, or exact substring match without regex).

---

### R4-V-005: D1-003 Negation Check — 10-Char Window Limitation

**Severity**: Low  
**Location**: `builtins/self-check-basic.mjs:48-49`  
**Violated Invariant**: D1-003 (negated success markers are rejected)

**Issue**:  
The negation check uses a 10-char window before the success marker: `text.slice(Math.max(0, match.index - 10), match.index)`. If the negation word is >10 chars before the marker, it won't be caught.

**Counterexample**:
```javascript
assessment = "The task is not at all done."
// "not" is 16 chars before "done"
// pre = " at all "  (10 chars before "done")
// /\bnot\s+$/.test(pre) === false
// markerFound = true, negation not detected
// FALSE POSITIVE
```

**Precondition Violated**: Negation words within the same sentence should be detected  
**Postcondition Violated**: Negated markers are accepted as success

**Fix**: Increase window size (e.g., 50 chars) or use sentence-boundary detection to check the entire sentence containing the marker.

---

## D3-005 Edge Skip — No Regression Found

**Location**: `visualizer/label-layout.ts` (edge skip loop)  
**Status**: ✅ Verified Correct

The edge skip logic (`if (!stateIds.has(a.nextStateId)) continue;`) correctly prevents invalid edges from being added to the dagre graph. All downstream references (`g.edges()`, `edgeEntries`, `labels`) only contain valid edges. Isolated nodes (states with no valid edges) are still added via `g.setNode` and handled correctly by dagre. No regression found.

---

## DA-R3-06 Empty FSM Message — Partial Verification

**Location**: `visualizer/document.ts:52`, `visualizer/document.ts:79`  
**Status**: ⚠️ Correct Timing, Broken Delivery (see R4-V-003)

The empty FSM warning fires at the correct point (during FSM construction) and the visualization still produces valid HTML with an empty graph. However, the warning delivery mechanism is broken (see R4-V-003) — `console.warn` may not reach the user.

---

## Recommendations

1. **R4-V-001 (Symlink)**: Use `fs.realpathSync()` before path containment check
2. **R4-V-002 (Trailing Slash)**: Normalize `cwd` with `resolve(cwd)` at function entry
3. **R4-V-003 (Warnings)**: Thread `ctx` to `document.ts` or return warnings from `createVisualizerArtifact`
4. **R4-V-004 (Word Boundary)**: Remove `\b` for non-word-char rubric items or use lookarounds
5. **R4-V-005 (Negation Window)**: Increase window to 50 chars or use sentence-boundary detection

---

## Verification Evidence

- `visualizer/create-artifact.ts:17,32` — `startsWith(cwd + sep)` confirmed
- `visualizer/label-layout.ts` — edge skip loop confirmed, no downstream references
- `visualizer/document.ts:41,52,79` — `console.warn` confirmed, no `ctx` parameter
- `builtins/self-check-basic.mjs:43` — `escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` confirmed
- `builtins/self-check-basic.mjs:48-49` — 10-char window confirmed
- `index.ts:471` — visualizer tool handler has `ctx` but does not thread it to `createVisualizerArtifact`
