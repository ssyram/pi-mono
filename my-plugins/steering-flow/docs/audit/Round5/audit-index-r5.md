# Round 5 Regression Audit — `index.ts` (Round 4 fixes)

**Date**: 2026-04-24
**Auditor**: Sisyphus-Junior
**Scope**: Verify Round 4 fixes R4-I-001 through R4-I-004 in `index.ts`; identify regressions or residual gaps.

---

## Summary

| Fix | Status | Finding |
|-----|--------|---------|
| R4-I-001 | ✅ Correct — one residual edge case, **not a bug** | See note below |
| R4-I-002 | ✅ Fully correct | No findings |
| R4-I-003 | ⚠️ Residual gap | **R5-001** |
| R4-I-004 | ✅ Fully correct | No findings |

---

## R4-I-001 — `writePendingPop` try/catch at both sites

**Verified sites**: `loadAndPush` (line 229) and `actionCall` (line 292).

Both sites wrap `writePendingPop` in try/catch, log the error, and do not rethrow. The `$END` sweep in `session_start` remains reachable as secondary recovery. ✅

**Edge case examined**: After a caught `writePendingPop` failure, `deletePendingPop` is called unconditionally at lines 237 and 303. If `writePendingPop` threw, no marker file was written, so `deletePendingPop` operates on a non-existent file.

**Resolution**: `deletePendingPop` in `storage.ts` swallows `ENOENT` and only rethrows other errors. Calling it on a missing file is safe. **Not a bug.**

**Verdict**: No findings.

---

## R4-I-002 — `ctx.ui.notify` guarded by `ctx.hasUI` in `session_start`

Both `ctx.ui.notify(...)` calls in `session_start` are guarded with `if (ctx.hasUI)`. All `notify` calls in `agent_end` (including inside the outer catch) are also guarded. Command handler `notify` calls are not guarded, but commands execute only in UI contexts where `hasUI` is always true — not a regression.

**Verdict**: No findings.

---

## R4-I-003 — `session_start` `withSessionLock` body wrapped in outer try/catch

### Finding R5-001

**ID**: R5-001
**Severity**: Medium
**Category**: Unhandled exception / error propagation

**Violated invariant**: The `session_start` hook must not propagate uncaught exceptions to the plugin host regardless of internal failure mode.

**What R4 fixed**: An inner try/catch was added inside the `withSessionLock` callback (line 784) to prevent the lock from being held forever on callback body errors.

**Residual gap**: The `withSessionLock(sid, async () => { ... })` call at line 784 itself has no outer try/catch. `withSessionLock` acquires the lock by chaining onto a promise queue. If the lock acquisition step throws (e.g., an I/O error in the underlying lock mechanism, or an unexpected rejection in the promise chain before the callback is invoked), the resulting rejected promise escapes `session_start` uncaught.

**Lock-forever risk**: Not present. `withSessionLock` uses a `tail` promise that always settles (`next.then(() => undefined, () => undefined)`), and the `finally` block unconditionally cleans up `sessionLocks`. The lock is always released. The gap is exclusively about the uncaught exception escaping the hook.

**Concrete counterexample**:
```
withSessionLock(sid, fn)
  → internally: prevSettled.then(fn)
  → if prevSettled itself rejects unexpectedly (edge case in promise chain)
  → fn is never called, tail still settles (lock released ✅)
  → but the returned promise from withSessionLock rejects
  → session_start has no outer try/catch → rejection propagates to plugin host
```

**Fix direction**: Wrap the `withSessionLock(sid, ...)` call in an outer try/catch (or `.catch(...)`) in `session_start`, mirroring the inner catch already present for the callback body.

---

## R4-I-004 — `popFsm` retry reads stack before attempt 2

**Verified**: The retry pre-check reads `stackAfterAttempt1` and compares `stackAfterAttempt1[stackAfterAttempt1.length - 1] !== fsmId`. The `readStack` call is inside the `catch (retryErr)` block.

**`readStack` throws**: `readStack` throws `CorruptedStateError` on non-ENOENT filesystem errors, non-array data, non-string entries, or invalid fsmId regex. If `readStack` throws during the retry pre-check, the exception propagates out of the `catch (retryErr)` block. This is acceptable — a `CorruptedStateError` during retry is a legitimate fatal condition that should surface, not be silently swallowed.

**Empty stack / ENOENT**: `readStack` returns `[]` on ENOENT. `[][length - 1]` is `undefined`, `undefined !== fsmId` is `true` → `popSucceeded = true`. Correct: if the stack file is gone, the FSM is certainly not on top.

**False negative risk**: Could the FSM be on the stack but not on top, causing the check to skip a valid retry? Within the session lock, no concurrent writes can occur, so the stack state between attempt 1 and the pre-check is stable. A false negative (FSM present but not on top) is a legitimate signal — it means something else was pushed after the FSM, and retrying a pop would be wrong. The logic is sound.

**Verdict**: No findings.

---

## Findings Index

| ID | Severity | Fix | Description |
|----|----------|-----|-------------|
| R5-001 | Medium | R4-I-003 | `withSessionLock` call in `session_start` has no outer try/catch; lock-acquisition-level throws escape the hook uncaught |

---

## No-Finding Confirmations

- **R4-I-001**: Both `writePendingPop` sites correctly wrapped; `deletePendingPop` on missing file is safe (ENOENT swallowed); `$END` sweep reachable. ✅
- **R4-I-002**: All `notify` calls in `session_start` and `agent_end` guarded by `ctx.hasUI`. ✅
- **R4-I-004**: Retry stack read is correctly scoped; `readStack` throws are appropriately fatal; empty-stack and false-negative cases handled correctly. ✅
