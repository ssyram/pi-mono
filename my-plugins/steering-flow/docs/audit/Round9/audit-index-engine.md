# Round 9 Regression Audit — index.ts, engine.ts, storage.ts

**Audit Date**: 2026-04-24  
**Scope**: Verify Round 8 fixes (R8-I-001, R8-I-002, R8-I-004, R8-E-001, R8-E-002, R8-E-003) for regressions only.

---

## Round 8 Fix Verification

### R8-I-001: session_start recovery verifies fsmId matches stack top before popping

**Status**: ⚠️ **REGRESSION FOUND** (R9-001)

**Verification Results**:
- ✅ Empty stack handled: `!stackForPop.length` branch calls `deletePendingPop` without popping
- ✅ Mismatch branch: `deletePendingPop` called when `stackForPop[top] !== pendingPop.fsmId`
- ❌ **readStack throws**: If `readStack(dir)` (line 805) throws `CorruptedStateError`, the outer `catch` at line 829 only logs the error — `deletePendingPop` is NOT called

**Regression**: R9-001 (see below)

---

### R8-I-002: abort check inside withSessionLock callback in agent_end

**Status**: ✅ **CONVERGED**

**Verification Results**:
- ✅ Abort check placement: `if (ctx.signal?.aborted) return;` inside withSessionLock callback (line ~750)
- ✅ Return value: bare `return;` — correct (no state touched before check)
- ✅ State consistency: early return before any state mutation — no inconsistency possible

---

### R8-I-004: loadAndPush cleans up FSM dir on pushFsm failure

**Status**: ✅ **CONVERGED**

**Verification Results**:
- ✅ Cleanup path: `fs.rm(\`${sessionDir}/${fsmId}\`, { recursive: true, force: true })` — correct path
- ✅ Original error rethrown: `throw pushErr` after cleanup attempt
- ✅ fs.rm failure handling: `.catch(() => {})` silently suppresses cleanup errors (acceptable — orphan dir is minor vs. losing original error context)

---

### R8-E-001: transition_log entries appended after committed transitions

**Status**: ✅ **CONVERGED**

**Verification Results**:
- ✅ Append timing: `runtime.transition_log.push(...chain)` called after `runtime.current_state_id = action.next_state_id` (state commit)
- ✅ Initialization: `runtime.transition_log ??= []` pattern handles uninitialized runtime
- ✅ TransitionRecord shape: `{ from, to, action_id, reason, timestamp: new Date().toISOString() }` — correct
- ✅ Both paths covered: $END path and epsilon-success path both append after commit

---

### R8-E-002: Only committed transitions logged (not rolled-back)

**Status**: ✅ **CONVERGED**

**Verification Results**:
- ✅ Rollback branch: `if (!epsilonResult.ok)` returns early with `runtime.current_state_id = snapshotStateId` — no push to transition_log
- ✅ Success-only logging: `transition_log.push(...chain)` only reachable in success block after rollback early-return

---

### R8-E-003: closed=true before settle() in error handler

**Status**: ✅ **CONVERGED**

**Verification Results**:
- ✅ Placement: `closed = true` then `settle(...)` in `child.on("error", ...)` handler
- ✅ settle() still callable: `closed` flag only gates `killTree()`'s SIGKILL attempt, does NOT block settle()'s promise resolution
- ✅ Consistent pattern: same `closed = true` → `settle()` sequence in `child.on("close", ...)` handler

---

## New Findings

### R9-001: Corrupted stack.json causes infinite recovery loop

**Severity**: MEDIUM  
**Location**: `index.ts` lines 803-829 (session_start recovery block)

**Description**:
If `readStack(dir)` throws `CorruptedStateError` (e.g., stack.json contains non-array data or invalid fsmId format), the exception is caught at line 829 and only logged. The `deletePendingPop` call is unreachable in this path, leaving the pending-pop marker on disk. Every subsequent `session_start` retriggers the same failing recovery attempt.

**Evidence**:
```typescript
// Line 803-829 (simplified)
try {
  const pendingPop = await readPendingPop(dir);
  if (pendingPop) {
    const stackForPop = await readStack(dir); // ← throws CorruptedStateError
    if (!stackForPop.length || stackForPop[...] !== pendingPop.fsmId) {
      await deletePendingPop(dir); // ← unreachable if readStack throws
    } else {
      await popFsm(dir);
      await deletePendingPop(dir); // ← unreachable if readStack throws
    }
  }
  // ... rest of recovery ...
} catch (e) {
  console.error('[steering-flow] session_start recovery error:', e); // ← only logs
}
```

**Impact**:
- Corrupted stack.json + pending-pop marker → stuck recovery loop
- Every session_start logs the same error, never clears marker
- User must manually delete `.pending-pop.json` to recover

**Recommendation**:
Add `deletePendingPop` to the catch block to clear the marker on any recovery failure:
```typescript
} catch (e) {
  console.error('[steering-flow] session_start recovery error:', e);
  await deletePendingPop(dir).catch(() => {}); // Best-effort cleanup
}
```

---

## Summary

**Round 8 Fixes**: 5/6 CONVERGED, 1 regression found  
**New Findings**: 1 (R9-001)

**Converged**:
- R8-I-002 (abort check in agent_end)
- R8-I-004 (loadAndPush cleanup)
- R8-E-001 (transition_log append timing)
- R8-E-002 (rollback exclusion)
- R8-E-003 (closed=true placement)

**Regressions**:
- R8-I-001 → R9-001 (corrupted stack.json causes infinite recovery loop)
