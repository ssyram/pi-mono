# Round 3 Fix Verification — index.ts

Date: 2026-04-24

---

## RC-A: writePendingPop called AFTER persistRuntime

### loadAndPush path
**PASS**

`persistRuntime(sessionDir, rt)` is called first, then `writePendingPop(sessionDir, fsmId)` is called conditionally on `entry.reached_end`. Order is correct.

### actionCall path
**PASS**

Inside the `result.success` try block: `persistRuntime` precedes `writePendingPop(sessionDir, fsmId)` gated on `result.reached_end`. Order is correct.

### NDA-05 orphan check (catch block)
**PASS**

Neither the `loadAndPush` catch nor the `actionCall` catch block calls `writePendingPop`. A `persistRuntime` failure exits early via error return without writing the marker — no orphan `pending-pop.json` can be created.

### Regressions
None detected. The `!entry.success` / `!result.success` branches also have no `writePendingPop` call, which is correct.

---

## D4-001: session_start body wrapped in withSessionLock

### Lock presence
**PASS**

The `pi.on("session_start", ...)` handler wraps all file I/O (`sweepTmpFiles`, `readPendingPop`, `popFsm`, `deletePendingPop`, `readStack`, `readState`) inside `await withSessionLock(sid, async () => { ... })`.

### Lock key consistency
**PASS**

- `session_start` lock key: `sid` = `ctx.sessionManager.getSessionId()`
- Tool handlers lock key: `sessionId` = `ctx.sessionManager.getSessionId()`
- `withSessionLock` normalizes to `sessionId || "_no_session_"` internally — both paths resolve to the same effective key.

### Regressions
None detected. One pre-existing issue noted (not introduced by this fix): `ctx.ui.notify` in `session_start` is called without a `ctx.hasUI` guard, unlike the `agent_end` hook. This is out of scope for RC-A/D4-001/D1-002 and predates Round 3.

---

## D1-002: popFsm retry on epsilon rollback failure + original error preserved

### Retry logic
**PASS**

In the `!entry.success` block, `popFsm(sessionDir)` is attempted in a try/catch. On failure, a second attempt is made in a nested try/catch. A `popSucceeded` boolean tracks the outcome; if both attempts fail, the return message appends `⚠️ WARNING: stack cleanup failed`.

### Original error preservation
**PASS**

The return value uses `entry.reasons` (the epsilon rollback failure reasons from the FSM), not `rollbackErr` from the catch block. The original error is not swallowed or replaced.

### Scope of retry
**PASS (by design)**

The retry logic applies only to the `!entry.success` (epsilon rollback failure) path. The `catch (e)` path around `enterStart` (hard exception path) has a single `popFsm` attempt — this is intentional and consistent with the fix scope.

### Regressions
None detected.

---

## Summary

| Fix    | Status | Notes |
|--------|--------|-------|
| RC-A   | ✅ PASS | Order correct in both loadAndPush and actionCall; no orphan marker possible |
| D4-001 | ✅ PASS | session_start fully locked; key matches tool handlers |
| D1-002 | ✅ PASS | Two-attempt retry present; original epsilon error preserved |
