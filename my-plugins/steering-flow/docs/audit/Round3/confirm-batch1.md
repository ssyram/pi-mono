# Audit Batch 1 — Independent Verification
**Reviewer**: Fresh reviewer (source-only, no prior audit docs read)  
**Date**: 2026-04-24  
**Scope**: D1-001 through D1-005  
**Method**: Direct source reads + targeted grep. No audit docs consulted.

---

## D1-001 (CRITICAL) — persistRuntime throw leaks FSM on stack

**Verdict: CONFIRMED-solid-rationale** *(with scope correction: not permanent)*

**Trace** (`index.ts` lines 259–271):

```
try {
  if (result.reached_end) await writePendingPop(sessionDir, fsmId);  // line 259
  await persistRuntime(sessionDir, rt);                               // line 260
} catch (persistErr) {
  return `✅ Action succeeded but state persistence failed...`;       // lines 261-263 — EARLY RETURN
}

if (result.reached_end) {
  await popFsm(sessionDir);        // line 270 — NEVER REACHED if catch fired
  await deletePendingPop(sessionDir);
}
```

The finding is structurally correct: if `persistRuntime` throws, the catch returns early and `popFsm` at line 270 never executes. The FSM entry remains on the stack for the duration of the session.

**Scope correction**: The finding claims the leak is *permanent*. This is overstated. `writePendingPop` runs at line 259 *before* `persistRuntime` — so the pending-pop marker is on disk. The `session_start` handler reads `readPendingPop` and calls `popFsm` as part of recovery, cleaning up the orphaned entry on next session start. The leak is session-scoped, not permanent.

**Severity**: Still CRITICAL within a session — the stop hook will loop indefinitely re-prompting because `state.json` was not updated to `$END`. But the "permanent" framing should be revised to "session-scoped leak with deferred recovery."

---

## D1-002 (CRITICAL) — epsilon failure rollback swallows popFsm error

**Verdict: CONFIRMED-triggering**

**Trace** (`index.ts` lines 198–205):

```
try {
  await popFsm(sessionDir);
} catch (rollbackErr) {
  console.error('...rollback failed...', rollbackErr);  // swallowed
}
return { ok: false, error: "...stack rolled back..." };  // always returned
```

If `popFsm` throws inside the rollback catch, the error is logged and discarded. The function still returns `{ ok: false }` — the caller believes the rollback succeeded and the stack is clean. In reality the FSM entry remains on the stack.

**Additional finding**: An identical pattern exists at lines 183–191 (the `enterStart` catch path) that the original finding did not mention. Same vulnerability, second site.

**Confirmed as stated**: caller gets a failed result, stack is silently corrupted.

---

## D1-003 (HIGH) — lookbehind bypassed by double-space or uppercase

**Verdict: PARTIALLY CONFIRMED** *(uppercase claim REJECTED; double-space claim CONFIRMED)*

**Source** (`builtins/self-check-basic.mjs` ~lines 44–46):

```js
const text = assessment.trim().toLowerCase();   // line ~44
const markerFound = SUCCESS_MARKERS.some(m =>
  new RegExp(`(?<!not\\s)(?<!no\\s)\\b${m}\\b`).test(text)
);
```

**Uppercase bypass — REJECTED**: `text` is forced to `.toLowerCase()` before the regex runs. `"NOT done"` becomes `"not done"` — the lookbehind `(?<!not\s)` fires correctly. No bypass.

**Double-space bypass — CONFIRMED**: `(?<!not\s)` checks exactly one character immediately before the match position. In `"not  done"` (two spaces), the character immediately before `d` is the second space `" "`. The lookbehind checks whether the 4-char sequence ending there is `"not "` — it is not (`"t  "` ≠ `"not "`). The lookbehind does not fire → false positive confirmed.

**Net**: The finding is half-right. Severity is reduced because the uppercase vector doesn't exist, but the double-space vector is real and sufficient to trigger a false positive.

---

## D1-004 (HIGH) — rubric `includes` has no word boundary

**Verdict: CONFIRMED-triggering**

**Source** (`builtins/self-check-basic.mjs` ~line 48):

```js
const rubricSatisfied = rubric.length === 0 ||
  rubric.every(item => text.includes(item.trim().toLowerCase()));
```

`String.prototype.includes` is a substring match with no word-boundary awareness. A rubric item `"ok"` matches inside `"book"`, `"cookbook"`, `"looked"`, etc. The finding is correct as stated.

**Compounding factor**: `"ok"` also appears in `SUCCESS_MARKERS` (~line 43). If `"ok"` is used as both a rubric item and a success marker, the substring collision affects both evaluation paths simultaneously.

---

## D1-005 (PARTIAL) — fallback to storage dir for `./` script paths

**Verdict: REJECTED-misreading**

**Source** (`engine.ts` lines 22–27, `resolveTokenRelToFlow`):

```ts
function resolveTokenRelToFlow(token: string, flowDir: string): string {
  if (!flowDir) return token;                        // line 22 — empty-string guard
  if (token.startsWith('./') || token.startsWith('../'))
    return pathResolve(flowDir, token);              // resolves against flowDir
  return token;
}
```

`./` tokens in command/args are explicitly resolved against `flowDir` (the original YAML directory, set as `dirname(absPath)` in `loadAndPush`). The storage directory is only the process `cwd` passed to `spawn` — it governs the working directory of the child process, not the resolution of config-level path tokens. These are separate parameters throughout `engine.ts`.

**The finding's premise is wrong**: `./` paths do NOT resolve against the storage dir. They resolve against `flowDir` which is the original YAML dir — exactly the correct behavior.

**Residual edge case** (not the finding's claim): If `runtime.flow_dir` is somehow empty string, `resolveTokenRelToFlow` returns the token unchanged at line 22, and the OS resolves it against spawn's `cwd` (which would be the storage dir). This is a narrow defensive gap, not the scenario described. The finding as written does not describe this case.

---

## Summary Table

| ID | Verdict | Core Issue |
|---|---|---|
| D1-001 | CONFIRMED-solid-rationale | popFsm skipped on persistRuntime throw; leak is session-scoped not permanent |
| D1-002 | CONFIRMED-triggering | rollback catch swallows popFsm error; stack silently corrupted |
| D1-003 | PARTIALLY CONFIRMED | double-space bypass real; uppercase bypass wrong (text is lowercased first) |
| D1-004 | CONFIRMED-triggering | `includes` substring match, no word boundary |
| D1-005 | REJECTED-misreading | `./` paths resolve against `flowDir` (YAML dir), not storage dir |
