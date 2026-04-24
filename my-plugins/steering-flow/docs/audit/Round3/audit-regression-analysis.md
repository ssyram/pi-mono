# Hoare Audit — Dimension D1: Regression Analysis of Round 2 Fixes

**Audit Date:** 2026-04-24  
**Scope:** Round 2 active fixes (NDA-01 through NDA-09)  
**Methodology:** Source code review with counterexample construction

---

## Executive Summary

Round 2 applied 8 active fixes. This dimension identifies **5 regressions** introduced by those fixes:

- **2 Critical** (D1-001, D1-002): FSM stack corruption, silent rollback failures
- **2 High** (D1-003, D1-004): False positives in self-check validation
- **1 Medium** (D1-005): Incomplete path resolution for migrated sessions

3 fixes (NDA-01, NDA-04, NDA-07) introduced no regressions.

---

## Findings

### D1-001: FSM Stack Leak on `writePendingPop` Failure (NDA-05 Regression)

**Severity:** Critical  
**Violated Invariant:** `INV-stack-consistency` — FSM stack must reflect active execution contexts  
**File:Line:** `index.ts:258-270`

**Description:**  
The NDA-05 fix wrapped `persistRuntime` in a try/catch block to prevent crashes. However, the catch block returns early, bypassing the `popFsm` call that should execute when `reached_end=true`. If `writePendingPop` throws (line 259), the FSM remains on the stack permanently.

**Counterexample:**
```javascript
// Precondition: FSM reaches $END state, result.reached_end = true
// Action: writePendingPop throws (e.g., disk full, permission denied)
// Expected: FSM popped from stack (or error propagated)
// Actual: catch block returns early → popFsm never called → FSM leaks on stack

// index.ts:258-270
try {
  await writePendingPop(sessionDir, fsmId, result.state);  // line 259 throws
  await persistRuntime(sessionDir, fsmId, runtime);        // line 260 skipped
} catch (err) {
  return `✅ Transitioned to ${result.state} (persistence failed: ${err})`;  // line 262 returns early
}

if (result.reached_end) {
  await popFsm(sessionDir);  // line 270 NEVER REACHED
}
```

**Root Cause:**  
Early return in catch block prevents cleanup code from executing.

**Recommended Fix:**  
Move `popFsm` inside a `finally` block or ensure it executes before returning from catch.

---

### D1-002: Silent Rollback Failure in Epsilon Chain (NDA-06 Regression)

**Severity:** Critical  
**Violated Invariant:** `INV-stack-consistency` — FSM stack must reflect active execution contexts  
**File:Line:** `index.ts:196-205`

**Description:**  
The NDA-06 fix added try/catch around `popFsm` rollback calls. The second rollback path (epsilon chain failure) catches rollback errors but only logs them without re-throwing. If `popFsm` fails during rollback, the FSM remains on the stack while the caller believes the operation was rolled back.

**Counterexample:**
```javascript
// Precondition: loadAndPush called, enterStart succeeds, epsilon chain fails
// Action: popFsm rollback throws (e.g., fs.rm fails)
// Expected: Error propagated to caller, stack state clearly inconsistent
// Actual: Error logged silently, caller receives epsilon failure, stack corrupted

// index.ts:196-205
if (!entry.success) {
  try {
    await popFsm(sessionDir);  // line 199 throws
  } catch (rollbackErr) {
    console.error(`[steering-flow] Rollback failed after epsilon chain error:`, rollbackErr);  // line 201 logs only
  }
  return { success: false, error: entry.error };  // line 203 returns without re-throwing
}
```

**Root Cause:**  
Rollback failure is swallowed; caller has no indication that stack is inconsistent.

**Recommended Fix:**  
Re-throw rollback error or append it to the returned error message. Caller must know the operation left the system in an inconsistent state.

---

### D1-003: Negative Lookbehind Bypassed by Multi-Space (NDA-03 Regression)

**Severity:** High  
**Violated Postcondition:** `POST-self-check-accuracy` — self-check must correctly identify success markers  
**File:Line:** `builtins/self-check-basic.mjs:43`

**Description:**  
The NDA-03 fix added negative lookbehind `(?<!not\s)(?<!no\s)` to prevent matching markers preceded by "not" or "no". However, `\s` matches exactly one whitespace character. If the user writes "not  done" (double space) or "not\tdone" (tab), the lookbehind fails to match and the marker is incorrectly detected.

**Counterexample:**
```javascript
// Input: assessment = "The task is not  done yet."  (double space between "not" and "done")
// Marker: "done"
// Regex: /(?<!not\s)(?<!no\s)\bdone\b/i
// Expected: No match (negated by "not")
// Actual: Match found (lookbehind only checks single space)

const text = "the task is not  done yet.";  // lowercased, double space preserved
const marker = "done";
const regex = new RegExp(`(?<!not\\s)(?<!no\\s)\\b${marker}\\b`, "i");
console.log(regex.test(text));  // true (false positive)
```

**Root Cause:**  
`\s` in lookbehind matches exactly one character; multiple spaces or tabs bypass the check.

**Recommended Fix:**  
Use `\s+` (one or more whitespace) or a word-boundary approach: `(?<!\bnot\s+)(?<!\bno\s+)`.

---

### D1-004: Rubric Substring Match Causes False Positives (NDA-02 Design Flaw)

**Severity:** High  
**Violated Postcondition:** `POST-self-check-accuracy` — self-check must correctly identify rubric satisfaction  
**File:Line:** `builtins/self-check-basic.mjs:45`

**Description:**  
The NDA-02 fix wired rubric checking into the self-check logic using `text.includes(item)`. This is a pure substring match with no word boundaries. Short rubric items like "ok", "yes", "true" will match inside longer words like "book", "cooking", "yes**terday**", "true**nate**".

**Counterexample:**
```javascript
// Rubric: ["ok", "complete"]
// Assessment: "I looked at the book and it's incomplete."
// Expected: Rubric NOT satisfied (neither "ok" nor "complete" present as standalone words)
// Actual: Rubric satisfied ("ok" found in "book", "complete" found in "incomplete")

const rubric = ["ok", "complete"];
const text = "i looked at the book and it's incomplete.";  // lowercased
const rubricSatisfied = rubric.every(item => text.includes(item.trim().toLowerCase()));
console.log(rubricSatisfied);  // true (false positive)
```

**Root Cause:**  
`String.includes()` performs substring matching without word boundaries.

**Recommended Fix:**  
Use word-boundary regex for rubric items: `new RegExp(`\\b${escapeRegex(item)}\\b`, "i")`.

---

### D1-005: `flow_dir` Fallback Resolves to Storage Dir, Not YAML Dir (NDA-09 Incomplete Fix)

**Severity:** Medium  
**Violated Postcondition:** `POST-path-resolution` — relative paths in condition scripts must resolve against flow YAML directory  
**File:Line:** `storage.ts:279`

**Description:**  
The NDA-09 fix added a fallback for missing `flow_dir`: `struct.flow_dir ?? fsmDir(sessionDir, fsmId)`. However, `fsmDir(sessionDir, fsmId)` returns `.pi/steering-flow/<session>/<fsm-id>/`, which is the FSM storage directory, NOT the original YAML directory. Condition scripts using relative paths like `./check-status.sh` will resolve against the storage dir, not the flow definition dir.

**Counterexample:**
```yaml
# flow.yaml located at /home/user/flows/deploy.yaml
# Condition script: ./scripts/check-env.sh (relative to /home/user/flows/)

states:
  - id: check
    condition: "./scripts/check-env.sh"  # expects /home/user/flows/scripts/check-env.sh
```

```javascript
// Migrated session (created before NDA-09 fix) lacks flow_dir field
// Fallback: flow_dir = fsmDir(sessionDir, fsmId) = ".pi/steering-flow/<session>/<fsm-id>/"
// Condition resolves to: .pi/steering-flow/<session>/<fsm-id>/scripts/check-env.sh
// Expected: /home/user/flows/scripts/check-env.sh
// Actual: .pi/steering-flow/<session>/<fsm-id>/scripts/check-env.sh (does not exist)
```

**Root Cause:**  
Fallback uses FSM storage directory instead of original YAML directory. The fix prevents crashes (empty string → storage dir) but does not restore correct path resolution for migrated sessions.

**Impact:**  
Migrated sessions with relative-path condition scripts will fail to resolve those paths correctly. New sessions (created after NDA-09 fix) are unaffected because `flow_dir` is written at FSM creation time.

**Recommended Fix:**  
Document that migrated sessions require manual `flow_dir` correction, or store the original YAML path in a migration metadata field.

---

## Fixes Without Regressions

### NDA-01: `$TAPE_FILE` Documentation (No Regression)

**Status:** ✅ Correct  
**Verification:** All examples in `docs/builtin-procedures.md` consistently use `"${$TAPE_FILE}"` syntax. No bare `$TAPE_FILE` references found.

---

### NDA-04: `chainEpsilon` namedArgs Default (No Regression)

**Status:** ✅ Correct  
**Verification:** `engine.ts:335` explicitly passes `{}` as the sixth argument to `runCondition`. The fix is redundant with the function's default parameter but introduces no behavioral change or regression.

---

### NDA-07: `failReasons` Collection (No Regression)

**Status:** ✅ Correct  
**Verification:** `engine.ts:332-345` declares `failReasons: string[]` inside the epsilon-state loop body, collects rejection reasons, and joins them with `" | "`. The array is local to each epsilon-state iteration (does not accumulate across depth levels). Within a single state, the joined string is bounded by the number of actions in that state — manageable in practice. No truncation needed.

---

## Summary Table

| Finding | Severity | Fix | Regression Type | Impact |
|---------|----------|-----|-----------------|--------|
| D1-001 | Critical | NDA-05 | FSM stack leak on writePendingPop failure | Permanent stack corruption |
| D1-002 | Critical | NDA-06 | Silent rollback failure in epsilon chain | Stack inconsistency undetected |
| D1-003 | High | NDA-03 | Multi-space bypasses negative lookbehind | False positive success detection |
| D1-004 | High | NDA-02 | Substring match without word boundaries | False positive rubric satisfaction |
| D1-005 | Medium | NDA-09 | Fallback resolves to storage dir, not YAML dir | Migrated sessions fail path resolution |
| — | — | NDA-01 | None | Documentation fix correct |
| — | — | NDA-04 | None | Redundant but harmless |
| — | — | NDA-07 | None | Correct implementation |

---

## Recommendations

1. **Immediate (Critical):** Fix D1-001 and D1-002 to prevent stack corruption.
2. **High Priority:** Fix D1-003 and D1-004 to prevent false positives in self-check validation.
3. **Medium Priority:** Document D1-005 limitation for migrated sessions or provide migration tooling.
4. **Process:** Add regression test suite covering these counterexamples before Round 3 fixes.
