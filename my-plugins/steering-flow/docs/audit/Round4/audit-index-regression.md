# Round 4 Regression Audit — index.ts & stop-guards.ts
**Scope:** Changes introduced in Round 3  
**Files audited:** `index.ts`, `stop-guards.ts`, `storage.ts` (contracts)  
**Auditor:** Sisyphus-Junior  
**Date:** 2026-04-24

---

## Summary

| ID | Area | Severity | Status |
|----|------|----------|--------|
| R4-I-001 | RC-A: writePendingPop partial-failure gap | Medium | Finding |
| R4-I-002 | D4-001: session_start ctx.ui.notify without hasUI guard | High | Finding |
| R4-I-003 | D4-001: session_start missing outer try/catch | Medium | Finding |
| R4-I-004 | D1-002: retry logic causes double-pop | High | Finding |
| R4-I-005 | Removed isAskingQuestion / findLastAssistant dead-code check | Pass | No finding |
| R4-I-006 | Removed CONFIRM_STOP_TAG / stop hook prompt | Pass | No finding |
| R4-I-007 | Compaction constant 30_000 | Pass | No finding |
| R4-I-008 | persistRuntime tape exclusion & divergence path | Pass | No finding |

---

## Detailed Findings

---

### R4-I-001 — RC-A: writePendingPop partial-failure leaves FSM stranded at $END

**Violated invariant:** If `reached_end = true` and the action succeeds, a `pending-pop.json` marker must exist on disk before the call returns, so that session_start crash-recovery can pop the finished FSM.

**Location:** `actionCall` (also `loadAndPush`), inside the success `try/catch` block.

**Observed code (actionCall):**
```ts
// inside try { ... } catch → returns early with error message
await persistRuntime(sessionDir, rt);
if (result.reached_end) await writePendingPop(sessionDir, fsmId);
```

**Scenario (actionCall):**
1. `result.reached_end = true`.
2. `persistRuntime` succeeds → state.json updated on disk.
3. `writePendingPop` throws (disk full, atomic rename race, etc.).
4. The `catch` block fires, returns `{ isError: true, content: "✅ Action succeeded but state persistence failed..." }`.
5. No `pending-pop.json` exists. `popFsm` (outside the try/catch) is never reached.
6. The FSM is now permanently stranded: state.json says `$END`, no pending-pop marker, stack still contains this FSM's ID. The next `session_start` will not auto-pop it because `readPendingPop` returns `undefined` and the `$END` sweep in session_start is the only other recovery path.

**Question: does the $END sweep cover this?**  
session_start does independently sweep the top-of-stack FSM for a stuck `$END` state (separate from the pending-pop path). If that sweep runs correctly, it would recover this case. However, the sweep also calls `ctx.ui.notify` without `hasUI` guard (R4-I-003), so in headless environments the sweep itself can abort — leaving the FSM stranded.

**Counterexample (loadAndPush):** Same mechanics apply identically — `writePendingPop` is inside the try/catch; a throw there returns early and leaves no marker.

**Severity:** Medium  
- In practice this requires `persistRuntime` to succeed and `writePendingPop` to fail, which is unlikely but not impossible (disk-full or filesystem interrupt between two atomic writes).  
- The $END sweep in session_start provides a second recovery path, partially mitigating this — but only in UI-capable environments.

---

### R4-I-002 — D4-001: session_start calls ctx.ui.notify without ctx.hasUI guard

**Violated invariant:** Code paths reachable in headless (no-UI) environments must not call `ctx.ui.*` unconditionally.

**Location:** `session_start` handler, inside `withSessionLock` body, ~lines 760 and 769.

**Observed code:**
```ts
// Line ~760 — pending-pop crash recovery path
ctx.ui.notify(`[steering-flow] Auto-popped FSM ${pendingPop.fsmId} (crash recovered...)`, "warning");

// Line ~769 — stuck $END sweep path
ctx.ui.notify(`[steering-flow] Auto-popped stuck $END FSM ${topId} from stack`, "warning");
```

**Contrast with agent_end (correct pattern):**
```ts
if (ctx.hasUI) {
    ctx.ui.notify(...);
}
```

**Counterexample:**
1. Plugin running in headless mode (`ctx.hasUI === false`, `ctx.ui === undefined`).
2. session_start fires; stack has a pending-pop marker from a prior crash.
3. `popFsm` + `deletePendingPop` succeed.
4. `ctx.ui.notify(...)` throws `TypeError: Cannot read properties of undefined (reading 'notify')`.
5. Exception propagates out of the `withSessionLock` callback, out of the async event handler — no outer catch (see R4-I-003).
6. The crash-recovery pop was **completed** (FSM is popped from disk), but the UI notification throws. In this case no data corruption — the pop already succeeded.

**However:** If `ctx.ui.notify` is between two stateful operations (e.g., `popFsm` succeeded but a second cleanup step follows after the notify call), the throw would interrupt the second step. Verify the exact interleaving.

**Severity:** High  
- `session_start` is the plugin's critical crash-recovery path. An unguarded `TypeError` here can abort recovery silently (swallowed by the framework's event handler machinery) or propagate and crash the session startup.
- `agent_end` correctly guards with `if (ctx.hasUI)` — the inconsistency is clearly unintentional.

---

### R4-I-003 — D4-001: session_start missing outer try/catch

**Violated invariant:** The session_start hook, which performs crash recovery and stack cleanup, must not leak exceptions to the framework.

**Location:** `session_start` async event handler body (the outermost level, before `withSessionLock`).

**Observed:** No outer `try/catch` around the handler body.

**Contrast with agent_end:** `agent_end` wraps its entire body in `try { ... } catch (e) { console.error(...); }`.

**Counterexample:**
1. `ctx.sessionManager.getSessionId()` throws (session not yet initialized in some edge case).
2. Exception propagates to the framework's event dispatch.
3. Behavior depends on framework: silently swallowed (session_start does nothing) or framework-level crash.

**Severity:** Medium  
- The `withSessionLock` callback itself has no catch either, so any throw from `readPendingPop`, `popFsm`, `readStack`, etc. escapes the handler.
- Combined with R4-I-002, a headless-environment notify call will produce an uncaught exception from session_start with no logging.

---

### R4-I-004 — D1-002: retry logic can cause double-pop

**Violated invariant:** A retry of a failed `popFsm` must be idempotent or must not pop a different FSM than the one being rolled back.

**Location:** `loadAndPush`, the `!entry.success` epsilon-rollback block (~lines 195–218).

**Observed code:**
```ts
try {
    await popFsm(sessionDir);         // Attempt 1
    popSucceeded = true;
} catch (rollbackErr) {
    console.error('... attempt 1 ...');
    try {
        await popFsm(sessionDir);     // Attempt 2
        popSucceeded = true;
    } catch (retryErr) {
        console.error('CRITICAL: ... attempt 2 ...');
    }
}
```

**`popFsm` contract (from storage.ts):**
```ts
// pops top of stack.json, writes stack.json, then best-effort rm of FSM dir
```
`popFsm` is NOT idempotent. It pops **whatever is currently at the top of the stack**. It does not take a target FSM ID to pop.

**Failure scenario producing double-pop:**
1. `pushFsm` succeeds — stack is `[..., fsmX, fsmY]` (fsmY is the just-pushed, now-failed FSM).
2. `popFsm` attempt 1: reads stack.json, removes `fsmY`, writes `[..., fsmX]` to stack.json.  
   **But**: the atomic rename of stack.json fails (e.g., another process holds a lock, or partial disk failure) → throws.
3. Depending on where the atomic write failed:  
   - **Case A (write not committed):** stack.json still has `[..., fsmX, fsmY]`. Attempt 2 pops `fsmY` again — same FSM, no corruption. (Best case.)  
   - **Case B (write committed before rename error is raised, i.e., temp file exists but rename failed):** stack.json was already updated to `[..., fsmX]`. Attempt 2 now pops `fsmX` — the **wrong FSM** — corrupt state. (Worst case.)
4. Case B leaves the stack missing `fsmX` (a valid, running FSM) permanently.

**Note on the catch-during-$START-entry path:**  
There is a separate `catch (e)` block for when `enterStart` itself throws (line ~175). In that path, `popFsm` is called once and the error is re-thrown on rollback failure — no retry. The double-pop risk is only in the `!entry.success` path.

**Root cause:** The retry should either:
- Pass the specific `fsmId` to pop (requires changing the `popFsm` API), or
- Check the current stack top before retrying to ensure it is still `fsmY`.

**Severity:** High  
- Corrupt FSM stack is not self-healing. The next `loadAndPush` or `actionCall` will operate on the wrong FSM, silently.
- The CRITICAL log fires on attempt 2 failure (both attempts throw) — but not on the Case B scenario where attempt 2 *succeeds* while popping the wrong FSM. There is no log emitted for that silent corruption.

---

### R4-I-005 — Removed isAskingQuestion / findLastAssistant: No dead code (Pass)

**Verification:**
- `isAskingQuestion`: not present anywhere in `index.ts`. ✓
- `CONFIRM_STOP_TAG`: not present anywhere in `index.ts`. ✓
- `findLastAssistant` in `stop-guards.ts`: **still used** — called by `wasAborted`, which is exported and used in `agent_end` to short-circuit stop-hook logic when the message was aborted. Not dead code. ✓
- No dangling import or reference found.

**Conclusion:** No finding.

---

### R4-I-006 — Removed CONFIRM_STOP_TAG / stop hook prompt injection (Pass)

**Verification:**
- `agent_end` reminder text: plain string using `renderStateView(rt)` with instructional prose. No `CONFIRM_STOP_TAG` string or tag injection. ✓
- No `CONFIRM_STOP_TAG` constant defined or referenced anywhere in `index.ts`. ✓
- `wasAborted` check in `agent_end` is the only remnant of the old stop-guard logic, and it correctly short-circuits the hook body when the message was aborted.

**Conclusion:** No finding.

---

### R4-I-007 — Compaction constant 30_000 (Pass)

**Verification:**
- `const COMPACTION_GUARD_MS = 30_000;` at line ~42. ✓
- No other hardcoded `60_000`, `60000`, or `60 * 1000` values found in `index.ts`.
- `session_compact` handler reads `COMPACTION_GUARD_MS` by name; no inline literal.

**Conclusion:** No finding.

---

### R4-I-008 — persistRuntime tape exclusion; no divergence path (Pass)

**Verification:**
- `persistRuntime` comment: *"Write state only — tape is managed separately by the tape-writing operations."*
- Implementation: calls only `writeState(sessionDir, rt.fsm_id, rt.current_state_id, rt.transition_log)`. No `writeTape` call. ✓
- After `executeAction` in `actionCall`: `rt.tape = await readTape(sessionDir, fsmId)` — explicit re-sync of in-memory tape from disk, so any tape writes made by condition scripts during action execution are picked up. ✓
- After `enterStart` in `loadAndPush`: same pattern — `rt.tape = await readTape(sessionDir, fsmId)`. ✓
- `loadAndPush` initial tape write: `await writeTape(sessionDir, fsmId, {})` at FSM creation time — initial tape committed before runtime object is built. ✓
- Tape write responsibility: condition scripts call `writeTape` directly during execution; the caller re-syncs in-memory state after. No path where in-memory tape diverges from disk after any await point visible to the caller.

**Conclusion:** No finding.

---

## Ordering Summary (RC-A)

Both `loadAndPush` and `actionCall` implement the correct RC-A order:

```
persistRuntime(sessionDir, rt)   // ← writes state.json atomically
  ↓ (if reached_end)
writePendingPop(sessionDir, fsmId)  // ← writes pending-pop.json marker
```

`popFsm` + `deletePendingPop` are called **outside** the success try/catch in `actionCall`, so a `popFsm` failure does not suppress the error — the exception propagates to the tool handler's outer catch, and the pending-pop marker on disk enables session_start recovery. This is the intended design and is correct.

The only gap (R4-I-001) is when `writePendingPop` itself fails — the catch fires early without a marker being written.

---

## D4-001 Deadlock Analysis

**No deadlock risk identified.**

- Tool handlers (`load-steering-flow`, `steering-flow-action`, etc.) call `withSessionLock(sessionId, ...)`.
- `session_start` calls `withSessionLock(sid, ...)` where `sid = ctx.sessionManager.getSessionId()`.
- `storage.ts` resolves the lock key as `sessionId || "_no_session_"` — same key for all callers using the same session.
- The framework does not call `session_start` concurrently with tool executions within the same session (session_start is a lifecycle event, tools are called during conversation turns). No nested lock acquisition.
- `withSessionLock` is not reentrant, but no call site acquires the lock while already holding it.

**Conclusion:** No deadlock possible under normal framework operation.

---

## Action Items (Prioritized)

| Priority | ID | Recommended Fix |
|----------|----|-----------------|
| P0 | R4-I-004 | Change `popFsm` retry to verify stack top is still `fsmId` before retrying, or add `fsmId` parameter to `popFsm`. Add a CRITICAL log if retry pops a different FSM. |
| P0 | R4-I-002 | Wrap all `ctx.ui.notify` calls in session_start with `if (ctx.hasUI)` guards, matching agent_end pattern. |
| P1 | R4-I-003 | Add outer `try/catch` around the entire session_start handler body, logging errors with `console.error`. |
| P2 | R4-I-001 | If `writePendingPop` throws after `persistRuntime` succeeds and `reached_end = true`, consider retrying `writePendingPop` before returning the error, or noting in the error message that the session_start $END sweep provides recovery. |
