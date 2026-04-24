# Audit: index.ts — Round 8

**Scope**: `index.ts`, `storage.ts`, `stop-guards.ts`
**Dimensions**: Concurrency, Error handling, State consistency, Hook logic, Tool handlers, Dead code

---

## Findings

### R8-I-001 — Unguarded `popFsm` / `deletePendingPop` sequence causes wrong-FSM pop on recovery
**Severity**: HIGH

**Locations**:
- `loadAndPush` reached_end branch (~lines 240–241)
- `actionCall` reached_end branch (lines 300–302)

**Description**:
Both branches follow this pattern after a successful `writePendingPop`:

```ts
await popFsm(sessionDir);
await deletePendingPop(sessionDir);
```

Neither call is wrapped in try/catch. If `popFsm` succeeds but `deletePendingPop` throws (e.g. transient FS error), the pending-pop marker file remains on disk with the now-stale `fsmId` of the FSM that was already popped.

On the next `session_start`, the recovery path reads the marker and calls `popFsm(dir)` unconditionally — it does **not** verify that `pendingPop.fsmId` matches the current stack top. At that point the stack top is the *parent* FSM (the child was already popped), so recovery pops the parent incorrectly.

**Scenario**:
1. Child FSM reaches end → `writePendingPop({fsmId: "child-123"})` succeeds.
2. `popFsm` succeeds — child removed from stack, stack now `[root, parent]`.
3. `deletePendingPop` throws — marker `{fsmId: "child-123"}` persists.
4. Session crashes / restarts.
5. `session_start` reads marker, calls `popFsm` — pops `parent` (the current top), leaving only `[root]`.
6. Parent FSM is silently lost.

**Fix**: Wrap the sequence in try/catch, or — better — have `session_start` recovery verify `pendingPop.fsmId === stack[stack.length - 1]` before popping, and log + discard the marker if they don't match.

---

### R8-I-002 — `agent_end` abort guard not re-checked after lock acquisition
**Severity**: MEDIUM

**Location**: `agent_end` hook body

**Description**:
The abort checks (`ctx.signal?.aborted` and `wasAborted(event.messages)`) run **before** `withSessionLock` is called. If the session is aborted while the hook is waiting to acquire the lock (e.g. another long-running tool call holds it), the checks are stale by the time the lock is granted and the hook body executes. The hook then proceeds to load state, evaluate stagnation, and potentially inject a stop reminder into an already-aborted session.

**Scenario**:
1. `agent_end` fires; abort checks pass (not aborted yet).
2. Lock is held by a concurrent tool call; hook queues behind it.
3. User aborts the session while the tool call is running.
4. Tool call finishes, releases lock; hook acquires it.
5. `ctx.signal?.aborted` is now true, but the check already passed — hook sends a spurious reminder.

**Fix**: Re-check `ctx.signal?.aborted` (and optionally `wasAborted`) as the first statement inside the `withSessionLock` callback, and return early if true.

---

### R8-I-003 — Silent error swallow in `infoCall` second `loadRuntime` call
**Severity**: LOW

**Location**: `infoCall`, the `loadRuntime` call for the stack-top FSM outside the loop

**Description**:
The catch block reads:
```ts
catch { // already surfaced above }
```
This comment is misleading — the second `loadRuntime` call is for the *top* FSM and is structurally separate from the per-FSM loop above it. An error here (e.g. corrupted state file for the active FSM) is silently swallowed and never logged or surfaced to the caller. The user gets a partial info response with no indication that the active FSM's runtime failed to load.

**Fix**: Either log the error at warn level before swallowing, or propagate it as a distinct error string in the returned info object.

---

### R8-I-004 — Orphaned FSM directory if `pushFsm` fails after writes in `loadAndPush`
**Severity**: LOW

**Location**: `loadAndPush`, the write sequence before `pushFsm`

**Description**:
The sequence is:
```ts
await writeFsmStructure(...)
await writeState(...)
await writeTape(...)
await pushFsm(...)   // if this throws, FSM dir exists on disk but is not on stack
```
If `pushFsm` fails (e.g. stack write error), the three preceding writes have already created the FSM directory and its files. There is no cleanup path — the orphaned directory accumulates on disk and is never referenced again.

This is low severity because `sweepTmpFiles` does not clean FSM dirs, and the orphan does not corrupt stack state (the stack write failed, so the stack is consistent). However, repeated failures can leave unbounded orphan dirs.

**Fix**: Wrap the sequence in try/catch; on failure, attempt `fs.rm(fsmDir(...), { recursive: true, force: true })` as best-effort cleanup before re-throwing.

---

## No Findings

- **Concurrency / lock coverage**: All state-mutating tool handlers and commands call `withSessionLock`. The `session_compact` handler correctly operates on a module-level Map (no disk I/O, no lock needed). `agent_end` is fully inside `withSessionLock` — no tool/hook interleave is possible.
- **`persistRuntime` failure in `actionCall`**: Caught and returned as an error string; disk state stays at pre-transition value. Correct rollback behavior.
- **Stagnation suppression in `agent_end`**: When `nextCount > STOP_HOOK_STAGNATION_LIMIT`, state is written with incremented count and the hook returns without sending a reminder. Suppression is correctly tied to state/tape content changes.
- **Input validation in tool handlers**: `save-to-steering-flow` validates `params.id` with regex and `isReservedJsName` before acquiring the lock. Other handlers validate required params before lock entry.
- **`stop-guards.ts`**: Pure function, no state, no side effects. No findings.
- **Dead code / unused imports**: None found.
- **`storage.ts` internal correctness**: `atomicWriteJson` uses pid+rand tmp suffix with rename; `readJsonStrict` maps ENOENT to undefined and other errors to `CorruptedStateError`; `popFsm` writes stack before best-effort rm (stack stays consistent on rm failure). No findings.
