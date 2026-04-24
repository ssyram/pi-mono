# Hoare Audit Dimension D5: Cross-Module Contract Consistency

**Auditor**: Sisyphus  
**Date**: 2026-04-24  
**Scope**: All cross-module function calls in `steering-flow` plugin  
**Files Audited**: `index.ts`, `engine.ts`, `parser.ts`, `storage.ts`, `builtin-registry.ts`, `types.ts`, `stop-guards.ts`

---

## Executive Summary

This audit examines cross-module contracts: whether callers and callees agree on argument types, return value semantics, and side-effect assumptions. **5 contract violations found**, all HIGH severity. The NDA-05 fix (try/catch around `persistRuntime`) introduced 3 new contract violations related to partial persistence and crash recovery.

---

## Findings

### D5-001: Partial Persistence After `writePendingPop` Success

**Severity**: HIGH  
**Violated Contract**: `persistRuntime` atomicity assumption  
**Location**: `index.ts:259-263`

**Description**:  
In `actionCall`, when `result.reached_end` is true, `writePendingPop(sessionDir, fsmId)` is called inside the same try block as `persistRuntime(sessionDir, rt)`. If `writePendingPop` succeeds but `persistRuntime` throws (e.g., disk full during `writeTape`), the catch block returns early with an error message. The FSM is left in an inconsistent state:
- `pending-pop.json` exists on disk (written at line 259)
- `state.json` still has the old `current_state_id` (before the final transition)
- `tape.json` is not updated with the final action's tape mutations
- The FSM remains on the stack (the `popFsm` call at line 270 is never reached due to early return at line 263)

**Counterexample**:
```
1. FSM at state "review", user invokes action "approve" → next_state_id = "$END"
2. executeAction succeeds: rt.current_state_id = "$END" (in-memory)
3. writePendingPop succeeds: pending-pop.json written
4. persistRuntime → writeTape succeeds, writeState throws (disk full)
5. Catch block returns error message, early exit
6. Disk state: pending-pop.json exists, state.json has current_state_id="review", tape.json partially updated
7. Next session_start: crash recovery sees pending-pop.json, calls popFsm
8. popFsm removes FSM dir with state.json showing "review" (not "$END")
9. User loses the final transition; FSM popped with stale state
```

**Pre-condition**: `result.reached_end === true`, `writePendingPop` succeeds, `persistRuntime` throws  
**Post-condition violated**: Caller assumes `writePendingPop` + `persistRuntime` are atomic; either both succeed or both fail  
**Invariant violated**: "pending-pop.json exists ⇒ FSM reached $END and was persisted"

**Fix**: Move `writePendingPop` AFTER `persistRuntime` succeeds, or wrap both in a transaction-like structure.

---

### D5-002: Stale Runtime After `persistRuntime` Failure (NDA-05 Interaction)

**Severity**: HIGH  
**Violated Contract**: In-memory runtime reflects disk state  
**Location**: `index.ts:249-263`, `engine.ts:268`

**Description**:  
`executeAction` mutates `runtime.current_state_id` in-place at `engine.ts:268` before returning. If the action succeeds but `persistRuntime` fails (caught at `index.ts:262`), the in-memory `rt` has the new `current_state_id` but disk still has the old state. The catch block returns an error message but does NOT rollback the in-memory `rt.current_state_id`. If the same session continues (e.g., user retries the action), subsequent operations use the mutated/stale runtime.

**Counterexample**:
```
1. FSM at state "idle", user invokes action "start" → next_state_id = "running"
2. executeAction succeeds: rt.current_state_id = "running" (in-memory mutation)
3. persistRuntime → writeTape succeeds, writeState throws (I/O error)
4. Catch block returns error message; rt.current_state_id still "running" in memory
5. User invokes /get-steering-flow-info in same session
6. infoCall loads fresh runtime from disk: current_state_id = "idle"
7. User sees "idle" in info output, but if they invoke another action without reloading, the stale in-memory rt with "running" is used
```

**Pre-condition**: `result.success === true`, `persistRuntime` throws  
**Post-condition violated**: Caller assumes `rt` is rolled back on persistence failure  
**Invariant violated**: "In-memory runtime.current_state_id === disk state.json current_state_id"

**Fix**: On `persistRuntime` failure, rollback `rt.current_state_id` to the snapshot before returning error.

---

### D5-003: Stagnation Hash Uses Stale State After Failed Persist

**Severity**: HIGH  
**Violated Contract**: Stagnation detector sees post-action state  
**Location**: `index.ts:704`, `index.ts:260-263`

**Description**:  
The Stop hook computes stagnation hash as `sha1(rt.current_state_id + "\0" + stableStringify(rt.tape))` using a fresh `loadRuntime` call at line 694. If the previous action succeeded but `persistRuntime` failed (NDA-05 catch path), disk `state.json` and `tape.json` are not updated. The Stop hook loads stale disk state → stagnation hash is computed with pre-action `current_state_id` + pre-action `tape`. The action's state advance is invisible to the stagnation detector → stagnation counter does NOT reset after a failed-persist action → premature stagnation detection possible.

**Counterexample**:
```
1. FSM at state "prompt_user", reminder_count = 2 (approaching limit 3)
2. User invokes action "submit" → next_state_id = "processing"
3. executeAction succeeds: rt.current_state_id = "processing", rt.tape["input"] = "new_value"
4. persistRuntime fails (disk full); catch returns error message
5. Disk: state.json has current_state_id="prompt_user", tape.json has old tape (no "input" key)
6. Stop hook fires: loadRuntime reads disk → rt.current_state_id = "prompt_user", rt.tape = old tape
7. Stagnation hash = sha1("prompt_user\0" + old_tape_json) — same as before the action
8. reminder_count increments to 3 → stagnation limit reached
9. Stop hook disables re-prompting, user sees "stagnation detected" even though state advanced
```

**Pre-condition**: Action succeeds, `persistRuntime` fails, Stop hook fires  
**Post-condition violated**: Stagnation detector assumes disk state reflects the latest action  
**Invariant violated**: "Stagnation hash changes ⇔ state or tape changed"

**Fix**: Either ensure `persistRuntime` never fails (retry logic), or track in-memory state separately for stagnation detection.

---

### D5-004: Crash Recovery Assumes `PendingPop` Implies Persisted State

**Severity**: HIGH  
**Violated Contract**: `PendingPop` existence guarantees FSM reached $END and was persisted  
**Location**: `index.ts:761-765`, `index.ts:259`

**Description**:  
The `session_start` crash recovery logic at line 761-765 assumes: if `pending-pop.json` exists, the FSM reached `$END` and was successfully persisted, so it's safe to call `popFsm` unconditionally. However, with the NDA-05 fix, `writePendingPop` runs inside the try block BEFORE `persistRuntime`. If `persistRuntime` fails after `writePendingPop` succeeds, `pending-pop.json` is written but `state.json` still has the old `current_state_id` (not `$END`). On next session start, crash recovery calls `popFsm` on an FSM that never persisted its final transition → FSM is popped with stale state → data loss.

**Counterexample**:
```
1. FSM at state "finalize", user invokes action "complete" → next_state_id = "$END"
2. executeAction succeeds: rt.current_state_id = "$END" (in-memory)
3. writePendingPop succeeds: pending-pop.json written
4. persistRuntime → writeTape succeeds, writeState throws (crash/disk error)
5. Process crashes before catch block executes
6. Next session_start: readPendingPop finds pending-pop.json
7. Crash recovery calls popFsm(dir) unconditionally
8. popFsm removes FSM dir; state.json had current_state_id="finalize" (not "$END")
9. User loses the final transition; FSM popped with stale state
```

**Pre-condition**: `writePendingPop` succeeds, `persistRuntime` fails, process crashes  
**Post-condition violated**: Crash recovery assumes `PendingPop` existence means FSM was persisted  
**Invariant violated**: "pending-pop.json exists ⇒ state.json has current_state_id=$END"

**Fix**: Move `writePendingPop` AFTER `persistRuntime` succeeds, or add a validation check in crash recovery to verify `state.json` has `current_state_id=$END` before popping.

---

### D5-005: `persistRuntime` Partial Write (Tape vs State Atomicity)

**Severity**: HIGH  
**Violated Contract**: `persistRuntime` is atomic (both tape and state succeed or both fail)  
**Location**: `index.ts:112-113`

**Description**:  
`persistRuntime` calls `writeTape(sessionDir, rt.fsm_id, rt.tape)` at line 112, then `writeState(sessionDir, rt.fsm_id, rt.current_state_id, rt.transition_log)` at line 113. If `writeTape` succeeds and `writeState` throws (e.g., disk full, I/O error), the catch in `actionCall` catches it. Disk is left in an inconsistent state:
- `tape.json` updated with new values
- `state.json` still has old `current_state_id` and old `last_transition_chain`

On next `loadRuntime`, the assembled runtime has new tape + old state → logical inconsistency. The comment at line 108-111 claims "state.json is the commit marker" but this only protects against crashes BETWEEN the two writes, not against `writeState` throwing.

**Counterexample**:
```
1. FSM at state "collect_data", tape = { "count": 5 }
2. User invokes action "increment" → next_state_id = "process", condition script writes tape["count"] = 6
3. executeAction succeeds: rt.current_state_id = "process", rt.tape = { "count": 6 }
4. persistRuntime → writeTape succeeds: tape.json = { "count": 6 }
5. writeState throws (disk quota exceeded)
6. Catch block returns error message
7. Disk: tape.json = { "count": 6 }, state.json = { current_state_id: "collect_data", ... }
8. Next loadRuntime: assembles runtime with current_state_id="collect_data", tape={ "count": 6 }
9. User sees state "collect_data" but tape has the incremented value from "process" state
```

**Pre-condition**: `writeTape` succeeds, `writeState` throws  
**Post-condition violated**: Caller assumes both tape and state are persisted atomically  
**Invariant violated**: "tape.json and state.json are consistent (both from same transition)"

**Fix**: Wrap `writeTape` + `writeState` in a transaction, or use a two-phase commit (write both to temp files, then rename atomically).

---

## Verified Correct Contracts

### ✅ `persistRuntime` → `storage.writeTape` / `storage.writeState`

**Location**: `index.ts:112-113`, `storage.ts:265`, `storage.ts:218`

**Contract**: `writeTape(sessionDir, fsmId, tape)` and `writeState(sessionDir, fsmId, currentStateId, lastTransitionChain, reminderMeta?)`

**Verification**:
- `index.ts:112`: `await writeTape(sessionDir, rt.fsm_id, rt.tape)` — args match `(sessionDir: string, fsmId: string, tape: Record<string, TapeValue>)` ✓
- `index.ts:113`: `await writeState(sessionDir, rt.fsm_id, rt.current_state_id, rt.transition_log)` — args match `(sessionDir: string, fsmId: string, currentStateId: string, lastTransitionChain: TransitionRecord[])` ✓
- No argument type mismatch, no missing parameters

---

### ✅ `actionCall` → `engine.executeAction`

**Location**: `index.ts:249`, `engine.ts:188-193`

**Contract**: `executeAction(runtime, actionId, positionalArgs, tapePath, cwd)`

**Verification**:
- `index.ts:248`: `const tapePath = tapePathFor(sessionDir, fsmId)` — computes absolute path string
- `index.ts:249`: `await executeAction(rt, actionId, args, tapePath, cwd)` — args match signature ✓
- `tapePath` is a string (absolute path), not a `(sessionDir, fsmId)` tuple — correct
- `executeAction` does NOT mutate `rt.transition_log` — caller correctly updates it at line 252 ✓

---

### ✅ `actionCall` Tape Re-sync After `executeAction`

**Location**: `index.ts:251`

**Contract**: Caller re-syncs `rt.tape` after `executeAction` because condition scripts may have written to `tape.json`

**Verification**:
- `index.ts:251`: `rt.tape = await readTape(sessionDir, fsmId)` — re-reads tape from disk after `executeAction` ✓
- `loadRuntime` at `storage.ts:275` reads tape once at load time; subsequent `writeTape` calls are not reflected in `rt.tape` until re-read
- `actionCall` correctly handles this by re-syncing before persisting ✓

---

### ✅ `saveCall` → `storage.readTape` / `storage.writeTape`

**Location**: `index.ts:297-302`, `storage.ts:255`, `storage.ts:265`

**Contract**: `readTape(sessionDir, fsmId)` and `writeTape(sessionDir, fsmId, tape)`

**Verification**:
- `index.ts:297`: `const tape = await readTape(sessionDir, fsmId)` — args match ✓
- `index.ts:302`: `await writeTape(sessionDir, fsmId, tape)` — args match ✓
- No argument mismatch; `saveCall` does NOT pass `tapePath` string as first arg (which would be a violation)

---

### ✅ `parser.validateCondition` → `builtin-registry.expandBuiltinCondition`

**Location**: `parser.ts:~210`, `builtin-registry.ts:30-60`

**Contract**: `expandBuiltinCondition(raw, actionId, stateId)` returns `{ cmd: "node", args: string[] }`, throws `Error` on invalid builtin

**Verification**:
- `parser.ts:~210`: calls `expandBuiltinCondition(c, actionId, stateId)`, wraps thrown `Error` as `ParseError`, then recursively calls `validateCondition(expanded, ...)` ✓
- `expandBuiltinCondition` returns `Record<string, unknown>` shaped as `{ cmd: "node", args: string[] }` — no `builtin` key in result
- Recursive `validateCondition` call goes to cmd-validation path (not builtin path again) — no infinite recursion ✓
- Return type matches `Condition` type from `types.ts` ✓

---

### ✅ Stop Hook `writeState` with `preserve_entered_at: true`

**Location**: `index.ts:720`, `index.ts:728`, `storage.ts:218-240`

**Contract**: `writeState` with `preserve_entered_at: true` preserves `entered_at` timestamp but overwrites `last_transition_chain`

**Verification**:
- `index.ts:720`: `await writeState(sessionDir, topId, rt.current_state_id, rt.transition_log, { reminder_count, last_reminder_hash, preserve_entered_at: true })` ✓
- `rt.transition_log` passed as `lastTransitionChain` equals what's already in `state.json` (loaded at line 694) — no-op overwrite, safe ✓
- `writeState` at `storage.ts:230-232` reads existing `entered_at` when `preserve_entered_at: true` — correct ✓
- No contract violation; `last_transition_chain` is intentionally overwritten (even though it's the same value)

---

### ✅ `withSessionLock` Usage Consistency

**Location**: All tool/command handlers in `index.ts`, `storage.ts:70`

**Contract**: `withSessionLock(sessionId, fn)` — first arg is `sessionId` string, not `sessionDir`

**Verification**:
- All calls pass `sessionId` (from `ctx.sessionId` or command arg) ✓
- `storage.ts:70`: `withSessionLock(sessionId: string, fn)` — signature matches ✓
- No calls pass `sessionDir` as first arg — correct

---

## Summary Statistics

- **Total cross-module calls audited**: 18
- **Contract violations found**: 5 (all HIGH severity)
- **Verified correct contracts**: 7
- **New violations introduced by NDA-05 fix**: 3 (D5-001, D5-003, D5-004)

---

## Recommendations

1. **Immediate**: Fix D5-001 and D5-004 by moving `writePendingPop` AFTER `persistRuntime` succeeds
2. **High Priority**: Fix D5-002 by rolling back `rt.current_state_id` on `persistRuntime` failure
3. **High Priority**: Fix D5-005 by implementing atomic tape+state persistence (two-phase commit or transaction)
4. **Medium Priority**: Fix D5-003 by adding retry logic to `persistRuntime` or tracking in-memory state for stagnation detection
5. **Testing**: Add integration tests for `persistRuntime` failure scenarios (disk full, I/O errors)

---

**Audit Complete**
