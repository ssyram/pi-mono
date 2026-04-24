# Hoare Audit — Dimension D3: Error Propagation
**Plugin:** steering-flow  
**Round:** 2  
**Date:** 2026-04-23  
**Scope:** engine.ts, index.ts, storage.ts  
**Contract baseline:** docs/audit/Round2/spec-gate.md

---

## Summary

7 findings. 2 HIGH, 3 MEDIUM, 2 LOW.

The two HIGH findings both involve silent state corruption: one where a successful action transition is never persisted to disk (disk/memory divergence), and one where a rollback failure during `loadAndPush` replaces the original error with an unrelated exception, leaving the FSM directory in an unknown state. The MEDIUM findings cover diagnostic information loss in condition failure messages and a silent swallow of stagnation-tracking writes in the stop hook.

---

## Findings

---

### D3-001 — `persistRuntime` failure after successful transition creates undetected disk/memory divergence

**Severity:** HIGH

**Violated contract:**  
Post-condition of `actionCall`: after a successful action, the on-disk `state.json` reflects the new `current_state_id`. The spec states that the persistent store is the source of truth; any reload must see the same state the engine just transitioned to.

**Affected file:line:** `index.ts:244`

**Code:**
```typescript
if (result.success) {
  await persistRuntime(sessionDir, rt);   // line 244 — no try/catch
  // ...
}
```

**Concrete scenario:**

1. User calls `action-steering-flow` with `action_id = "submit"`.
2. Engine executes the action, condition passes, `runtime.current_state_id` is updated in memory to `"review"`.
3. `persistRuntime` attempts to write `state.json` to disk. The disk is full (`ENOSPC`).
4. `persistRuntime` throws. The exception propagates through `withSessionLock` → outer `try/catch` in the tool handler → `friendlyError(e)` → the tool returns an error message to the caller.
5. The caller sees an error and assumes the action failed.
6. On the next call, `loadRuntime` reads the old `state.json` from disk, which still shows `current_state_id = "draft"`.
7. The FSM silently regresses: the transition to `"review"` is lost, but no corruption is flagged.

**Information loss:** The error message from `friendlyError` says something like `"ENOSPC: no space left on device"` with no mention of `state_id`, `fsm_id`, or the fact that the transition itself succeeded and only the persistence step failed. The user cannot distinguish "action failed" from "action succeeded but could not be saved."

**Invariant broken:** `disk_state_id == memory_state_id` after any successful tool call.

---

### D3-002 — `popFsm` throw during `loadAndPush` rollback replaces original error and leaves FSM dir in unknown state

**Severity:** HIGH

**Violated contract:**  
Post-condition of `loadAndPush` on failure: the FSM directory is removed (rollback complete) and the caller receives an error describing why the load failed. Both must hold; if rollback itself fails, the caller must still receive the original failure reason plus a rollback failure notice.

**Affected file:line:** `index.ts:180`, `index.ts:190`

**Code (enterStart failure path, line 179–183):**
```typescript
} catch (e) {
  await popFsm(sessionDir);              // line 180 — no try/catch
  return { error: `Flow '${flowName}' failed during $START entry; stack rolled back. Cause: ${(e as Error).message}` };
}
```

**Code (epsilon chain failure path, line 188–195):**
```typescript
if (!entry.success) {
  await popFsm(sessionDir);              // line 190 — no try/catch
  return { error: `Flow '${flowName}' loaded but its initial epsilon chain from $START failed; stack rolled back. Reasons:\n${...}` };
}
```

**Concrete scenario:**

1. User calls `load-steering-flow` for flow `"onboarding"`.
2. `enterStart` fails (e.g., `$START` epsilon chain has no matching condition).
3. The catch block at line 179 calls `await popFsm(sessionDir)`.
4. `popFsm` calls `fs.rm(fsmDir, { recursive: true, force: true })`. The directory is on a network mount that returns `EPERM`.
5. `fs.rm` throws `EPERM`. The exception escapes `popFsm` (the inner catch at `storage.ts:118` swallows the rm error — but only if `popFsm` itself has that guard; if the throw escapes the guard, it propagates to the caller).
6. The `EPERM` exception propagates out of the `catch (e)` block at line 179, bypassing the `return { error: ... }` at line 183.
7. The caller receives `"EPERM: operation not permitted"` with no mention of `flowName`, the original `$START` failure reason, or the fact that the FSM directory was not cleaned up.
8. The FSM directory remains on disk. The session's FSM stack is now inconsistent.

**Information loss:** Original `enterStart` error reason is completely discarded. `flowName` is lost. Rollback status (partial/complete) is unknown to caller. `fsmId` and `sessionId` are absent from all error paths in `loadAndPush`.

---

### D3-003 — `renderTransitionResult` failure hint omits `needs_tape` caveat (Deferred Issue 7)

**Severity:** MEDIUM

**Violated contract:**  
Post-condition of `renderTransitionResult` on condition failure: the returned hint must be sufficient for the user to diagnose why the condition received the arguments it did. Specifically, the hint must cover both the tape-path mechanism (`$TAPE_FILE`) and the `needs_tape` field that controls whether tape content is passed as positional arguments.

**Affected file:line:** `engine.ts:456`

**Code:**
```
_Hint: use `save-to-steering-flow` to write context into tape.json; condition commands can
reference the tape path via `${$TAPE_FILE}` in their `cmd` or `args`._
```

**Concrete scenario:**

1. User defines an action with a condition script that reads positional args: `my-condition.sh "$1" "$2"`.
2. The action definition does NOT set `needs_tape: true`.
3. The condition is called with `llmArgs = ["val1", "val2"]` (explicit action call); the condition script expects tape content as positional args.
4. The condition exits non-zero. `renderTransitionResult` returns the failure hint.
5. The hint tells the user to use `$TAPE_FILE` — but the user's script uses `$1`/`$2`, not `$TAPE_FILE`.
6. The user adds `save-to-steering-flow` calls but the condition still fails, because tape content is only passed as positional args when `needs_tape: true` is set on the action.
7. Nothing in the hint or the failure message mentions `needs_tape` or that positional args to the condition depend on it.

**Information loss:** The user cannot determine from the tool output alone whether their condition received tape content as positional args or not. The diagnostic gap between "condition failed" and "condition failed because needs_tape was not set" requires reading the source or documentation.

---

### D3-004 — `chainEpsilon` discards per-condition rejection reasons; only final no-match string returned

**Severity:** MEDIUM

**Violated contract:**  
Post-condition of `chainEpsilon` on failure: the returned error must include sufficient information to identify which conditions were evaluated and why each was rejected, so the user can diagnose routing failures without re-running with instrumentation.

**Affected file:line:** `engine.ts:337`

**Code:**
```typescript
// loop at ~328-335 collects results but discards res.reason values
return { ok: false, error: `epsilon state '${state.state_id}' had no matching condition (and no { default: true })` };
```

**Concrete scenario:**

1. An epsilon state `"route"` has three conditions: `check-auth.sh`, `check-role.sh`, `check-quota.sh`.
2. All three conditions fail. `check-auth.sh` exits 1 with stdout `"false"` and stderr `"token expired"`. `check-role.sh` exits 1. `check-quota.sh` fails to spawn.
3. `chainEpsilon` returns: `epsilon state 'route' had no matching condition (and no { default: true })`.
4. The user sees only the state name. They do not know: which conditions were tried, what each returned, or that `check-quota.sh` failed to spawn (a different class of error from a condition returning false).

**Information loss:** All per-condition `res.reason` values are discarded in the loop. The spawn failure from `runCondition` (which returns `"failed to spawn 'check-quota.sh': ..."`) is indistinguishable from a normal false return at the `chainEpsilon` output level.

---

### D3-005 — `writeState` failures in `agent_end` stagnation path silently swallowed; stagnation count not persisted

**Severity:** MEDIUM

**Violated contract:**  
Invariant: stagnation tracking state written during `agent_end` must either be persisted or the failure must be surfaced to the user. Silent loss of stagnation count updates can cause the stagnation limit to never trigger, allowing infinite loops.

**Affected file:line:** `index.ts:700`, `index.ts:709`, `index.ts:~728`

**Code:**
```typescript
// inside agent_end lambda — no individual try/catch on these calls
await writeState(sessionDir, { ...state, stagnation_count: newCount });  // line 700 or 709
// ...
} catch {
  // Hooks must never throw                                               // line ~728
}
```

**Concrete scenario:**

1. Agent completes a turn. `agent_end` hook fires.
2. The stagnation tracking branch runs and calls `writeState` to increment `stagnation_count`.
3. `writeState` calls `atomicWriteJson`, which calls `fs.writeFile` on a full disk. It throws `ENOSPC`.
4. The exception bubbles up through the `agent_end` lambda to the outer `catch` at line ~728.
5. The outer catch swallows it silently. No log, no `ctx.ui.notify`, no user message.
6. `stagnation_count` on disk remains at its previous value. On the next turn, the same stagnation check runs against the stale count.
7. If the disk remains full, stagnation count is never incremented. The stagnation limit never fires. The agent loops indefinitely.

**Distinction from intentional swallow:** The spec documents the outer catch as intentional ("Hooks must never throw"). The intent is to prevent hook errors from crashing the agent turn — not to silently discard writes that affect correctness. A `ctx.ui.notify` call before the swallow would preserve the intent while surfacing the failure.

---

### D3-006 — `popFsm` swallows `fs.rm` errors silently; orphaned FSM directory not reported to caller

**Severity:** LOW

**Violated contract:**  
Post-condition of `popFsm`: the FSM directory is removed from disk. If removal fails, the caller must be informed so it can report the orphan to the user.

**Affected file:line:** `storage.ts:118–120`

**Code:**
```typescript
} catch {
  // Leave orphan on rm error; not fatal
}
```

**Concrete scenario:**

1. `loadAndPush` rollback calls `popFsm(sessionDir)` after an `enterStart` failure.
2. `fs.rm` with `{ recursive: true, force: true }` encounters `EPERM` on a subdirectory (e.g., a read-only file inside the FSM dir).
3. The catch at line 118 swallows the error. `popFsm` returns normally.
4. `loadAndPush` proceeds to return `{ error: "... stack rolled back." }` — implying rollback succeeded.
5. The FSM directory remains on disk. `stack.json` no longer references it, so `sweepTmpFiles` will not clean it up either.
6. The orphan accumulates silently. The user's error message says "stack rolled back" which is false.

**Note:** `force: true` suppresses `ENOENT` (expected), but does not suppress `EPERM`, `ENOSPC`, or `EIO`. The comment "not fatal" is correct for the lock-release use case but misleading here where the caller's error message depends on rollback having succeeded.

---

### D3-007 — Raw `fs` errors in `readJsonStrict` propagate without file path context

**Severity:** LOW

**Violated contract:**  
Post-condition of `readJsonStrict` on error: the thrown error must include the file path so the caller can construct a meaningful error message without needing to re-wrap.

**Affected file:line:** `storage.ts:52`

**Code:**
```typescript
} catch (e: any) {
  if (e.code === 'ENOENT') return undefined;
  throw e;   // line 52 — raw re-throw, no path added
}
// vs. JSON parse path:
throw new CorruptedStateError(path, e);   // line 57 — path included
```

**Concrete scenario:**

1. `loadRuntime` calls `readJsonStrict(stateFile)` where `stateFile` is on a network mount.
2. The mount returns `EIO` (I/O error). `readJsonStrict` re-throws the raw `EIO` error.
3. The error message is `"EIO: i/o error, read"` with no file path.
4. `loadRuntime` does not wrap the error; it propagates to `withSessionLock` → `friendlyError`.
5. `friendlyError` returns `e.message` = `"EIO: i/o error, read"`.
6. The user sees `"EIO: i/o error, read"` with no indication of which file, which session, or which FSM was being read.

**Contrast:** `CorruptedStateError` (JSON parse path) correctly includes `path` and `cause`. The `ENOENT` path correctly returns `undefined`. Only the "other fs error" path is missing path context.

---

## Contract Verification: `withSessionLock` error propagation

**Result: PASS**

`withSessionLock` at `storage.ts:66–83` correctly propagates errors from `fn()` to the caller:

```typescript
const next = tail.then(fn);
sessionLocks.set(key, next.then(() => undefined, () => undefined));
try {
  return await next;   // fn() errors re-throw here
} finally {
  if (sessionLocks.get(key) === ...) sessionLocks.delete(key);
}
```

- `await next` re-throws if `fn()` rejects — error reaches the caller.
- The `finally` block releases the lock regardless of outcome.
- The tail stored in `sessionLocks` always settles resolved (via `() => undefined` rejection handler), so the next waiter always runs even after an error.

No finding raised for this boundary.

---

## Contract Verification: Stop hook intentional swallow boundary

**Result: PARTIAL PASS — see D3-005**

The outer `catch` in `agent_end` is documented as intentional. The audit verified:

- `readStack` errors → surfaced via `ctx.ui.notify` (correct, not swallowed)
- `loadRuntime` errors → surfaced via `ctx.ui.notify` (correct, not swallowed)
- `writeState` errors in stagnation path → silently swallowed (D3-005, MEDIUM)
- `pi.sendUserMessage` errors → silently swallowed (acceptable; UI delivery failure is non-critical)

The boundary between "errors that affect correctness" and "errors that are truly non-fatal" is not enforced structurally — it depends on which calls happen to be inside inner try/catch blocks vs. exposed to the outer swallow.

---

## Finding Index

| ID | Severity | File | Line | Topic |
|----|----------|------|------|-------|
| D3-001 | HIGH | index.ts | 244 | `persistRuntime` failure after success → disk/memory divergence |
| D3-002 | HIGH | index.ts | 180, 190 | `popFsm` throw during rollback replaces original error |
| D3-003 | MEDIUM | engine.ts | 456 | `renderTransitionResult` hint omits `needs_tape` caveat |
| D3-004 | MEDIUM | engine.ts | 337 | `chainEpsilon` discards per-condition rejection reasons |
| D3-005 | MEDIUM | index.ts | 700, 709, ~728 | `writeState` in stop hook silently swallowed |
| D3-006 | LOW | storage.ts | 118–120 | `popFsm` swallows `fs.rm` errors; orphan not reported |
| D3-007 | LOW | storage.ts | 52 | Raw fs errors in `readJsonStrict` lose file path context |
