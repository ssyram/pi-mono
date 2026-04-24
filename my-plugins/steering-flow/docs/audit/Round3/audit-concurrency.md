# Hoare Audit — Dimension D4: Concurrency & Session Lock

**Plugin:** steering-flow  
**Scope:** `withSessionLock` implementation · lock coverage across all entry points · session lifecycle hooks  
**Files inspected:** `storage.ts`, `index.ts`  
**Date:** 2026-04-24

---

## Summary

| ID | Severity | Title |
|---|---|---|
| D4-001 | **CRITICAL** | `session_start` hook performs multi-step state mutations without the session lock |
| D4-002 | **MEDIUM** | `withSessionLock` is non-reentrant — recursive call on the same key deadlocks permanently |
| D4-003 | **LOW** | `sweepTmpFiles` PID-tag guard only protects against the *same* process; a second concurrent process gets no protection |
| D4-004 | **INFO** | `lastCompactionAt.delete(sid)` in `session_start` is performed outside the lock — stale read window exists |

---

## D4-001 — `session_start` hook mutates shared state without the session lock

**Severity:** CRITICAL  
**File:** `index.ts:752–778`

### Violated invariant

> **Lock invariant:** Every read-modify-write sequence on session-scoped state (stack, state.json, pendingPop marker) must execute entirely within a single `withSessionLock` critical section for that session.

### What the code does

```typescript
// index.ts:752
pi.on("session_start", async (_event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    lastCompactionAt.delete(sid);
    const dir = getSessionDir(ctx.sessionManager.getCwd(), sid);

    await sweepTmpFiles(dir);               // line 758 — reads filesystem, deletes files

    const pendingPop = await readPendingPop(dir);   // line 761 — reads pendingPop marker
    if (pendingPop) {
        await popFsm(dir);                  // line 763 — writes stack.json
        await deletePendingPop(dir);        // line 764 — deletes pendingPop marker
        ...
    }

    const stack = await readStack(dir);             // line 769 — reads stack.json
    if (stack.length > 0) {
        const topId = stack[stack.length - 1];
        const state = await readState(dir, topId);  // line 772 — reads state.json
        if (state && state.current_state_id === "$END") {
            await popFsm(dir);                      // line 774 — writes stack.json
            ...
        }
    }
});
```

No `withSessionLock` call appears anywhere in this handler.

### Concrete counterexample

Pi fires parallel tool calls in the same turn. Consider:

```
T=0   session_start fires (e.g. fork/resume mid-session)
T=1   session_start: readPendingPop → finds pendingPop={fsmId:"fsm-42"} → decides to pop
T=1   [concurrent] steering-flow-action tool call fires on same sessionId → acquires lock →
          loadRuntime for "fsm-42" → executeAction → writeTape → writeState (committed)
T=2   session_start: popFsm(dir) → reads stack.json, removes "fsm-42", writes stack.json
          (unaware that actionCall just wrote fresh state.json for fsm-42)
T=3   session_start: deletePendingPop → marker gone
T=4   actionCall lock released — its committed state now orphaned (stack no longer references fsm-42)
```

**Post-condition violated:** after `session_start`, the stack no longer contains `fsm-42`, but `fsm-42/state.json` and `fsm-42/tape.json` were just updated by the concurrent tool call. The recovery logic consumed a real active FSM, not just a crashed orphan.

**Second scenario — stack.$END sweep races with load-steering-flow:**

```
T=0   session_start: readStack → [fsm-99] (current active FSM in $WAIT state)
T=0   [concurrent] load-steering-flow fires: acquires lock → pushFsm("fsm-100") → writes stack.json → [fsm-99, fsm-100]
T=1   session_start: topId = "fsm-99"; readState → {current_state_id:"$WAIT"}
          (no pop — correct, but now reads stale stack, misses that "fsm-100" was pushed)
```

This is a stale-read: the hook operates on a snapshot of `stack.json` taken before the lock was held, and the in-lock writer's update is invisible to the hook.

### Fix

Wrap the entire `session_start` body (after `lastCompactionAt.delete`) in `withSessionLock(sid, ...)`:

```typescript
pi.on("session_start", async (_event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    lastCompactionAt.delete(sid);
    const dir = getSessionDir(ctx.sessionManager.getCwd(), sid);
    await withSessionLock(sid, async () => {
        await sweepTmpFiles(dir);
        // ... rest of handler
    });
});
```

---

## D4-002 — `withSessionLock` is non-reentrant; same-key recursive call deadlocks permanently

**Severity:** MEDIUM  
**File:** `storage.ts:70–87`

### Violated invariant (pre-condition)

> **Pre-condition of `withSessionLock`:** The callback `fn` must never call `withSessionLock` with the same `sessionId` (same key), directly or transitively.

This pre-condition is **nowhere documented** in the source or types. It is a latent trap for any future caller.

### Mechanism

```typescript
// storage.ts:70-87
export async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const key = sessionId || "_no_session_";
    const prev = sessionLocks.get(key) ?? Promise.resolve();
    const prevSettled = prev.then(() => undefined, () => undefined);
    const next: Promise<T> = prevSettled.then(fn);   // ← fn is queued behind prev
    const tail = next.then(() => undefined, () => undefined);
    sessionLocks.set(key, tail);
    try {
        return await next;
    } finally {
        if (sessionLocks.get(key) === tail) sessionLocks.delete(key);
    }
}
```

When `fn` calls `withSessionLock(same-key, innerFn)`:

1. Inner call reads `prev = sessionLocks.get(key)` → gets `tail` (the outer caller's tail promise).
2. Inner `next2 = tail.then(innerFn)` — but `tail` resolves only *after* the outer `fn` resolves.
3. Outer `fn` is `await next` — which runs `fn`, which is now stuck waiting for `next2`.
4. Circular: `next2` waits for `tail`, `tail` waits for `next` to settle, `next` runs `fn`, `fn` waits for `next2`. **Permanent hang — no timeout, no error.**

### Concrete counterexample

No current code path triggers this. However, if `agent_end` or any hook were to call a helper that internally uses `withSessionLock` for the same session (e.g., a future refactor moves `loadRuntime` to be lock-aware), the entire Node.js event loop for that session stalls indefinitely. There is no watchdog.

### Fix

Options in order of preference:

1. **Document and enforce at the type level:** make `fn` return a `Promise<T>` and add a JSDoc `@throws` / `@remarks` block explicitly stating non-reentrancy.
2. **Add a reentrance guard:** maintain a `Set<string>` of currently-executing keys; throw synchronously if called re-entrantly.
3. **Implement an async reentrant mutex** (e.g., using `AsyncLocalStorage` to carry a "lock-held" token and skip re-acquisition when the token matches).

---

## D4-003 — `sweepTmpFiles` PID guard does not protect against a second process on the same session directory

**Severity:** LOW  
**File:** `storage.ts:147–166`

### Violated invariant

> **Invariant of `atomicWriteJson`:** A `.tmp.<pid>.<hex>` file in-flight from process A is only visible as a committed file after the `rename` syscall completes. Until then it is an orphan if process A crashes.

### What the code does

```typescript
// storage.ts:151-152
const ownTag = `.tmp.${process.pid}.`;
const isOrphanTmp = (name: string) => name.includes(".tmp.") && !name.includes(ownTag);
```

The guard skips deletion of any `.tmp.` file tagged with the current PID, protecting in-flight writes from *this* process. Files from *other* PIDs are deleted.

### Concrete counterexample

Two Pi processes share the same `CWD` and `sessionId` (e.g., two terminals running `pi` in the same project directory with the same active session):

```
Process A (pid=1001): steering-flow-action → acquires lock (per-process in-memory Map) →
    atomicWriteJson begins → writes state.json.tmp.1001.ab12
Process B (pid=2002): session_start → sweepTmpFiles → sees "state.json.tmp.1001.ab12" →
    isOrphanTmp("...tmp.1001...") with ownTag=".tmp.2002." → TRUE → deletes the file
Process A: rename(state.json.tmp.1001.ab12, state.json) → ENOENT → throws →
    atomicWriteJson deletes the tmp file (already gone) → state.json not written → data loss
```

**Note:** `withSessionLock` uses an **in-memory** `Map` (`sessionLocks` in `storage.ts:68`). It provides no inter-process mutual exclusion. Two processes can both believe they hold the lock simultaneously.

### Impact

This is inherently a multi-process scenario. Single-process usage (the overwhelmingly common case) is not affected. The sweep also only runs at `session_start`, limiting the attack window. Severity is LOW but worth documenting as an architectural boundary condition.

### Fix

Document clearly that the lock is single-process only and that running two Pi processes against the same session directory is unsupported. Alternatively, use a file-based lock (e.g., `proper-lockfile`) for cross-process serialization.

---

## D4-004 — `lastCompactionAt.delete(sid)` in `session_start` is outside the lock

**Severity:** INFO  
**File:** `index.ts:755`

### Context

`lastCompactionAt` is a module-level `Map<string, number>` that stores the last compaction timestamp per session. The `agent_end` hook reads it inside the lock at line 675:

```typescript
// index.ts:675 (inside withSessionLock)
const lastCompact = lastCompactionAt.get(sessionId) ?? 0;
if (Date.now() - lastCompact < COMPACTION_GUARD_MS) return;
```

`session_start` deletes the entry outside any lock:

```typescript
// index.ts:755 (no lock)
lastCompactionAt.delete(sid);
```

### Race

```
T=0  agent_end fires: reads lastCompactionAt.get(sid) → 0 (just reset by session_start)
     → passes cooldown guard → acquires lock → begins compaction
T=0  session_start fires (e.g. fork): lastCompactionAt.delete(sid) (already 0, no-op here)
T=1  agent_end: lastCompactionAt.set(sid, Date.now()) → records timestamp
T=2  Another agent_end fires immediately after: reads timestamp → cooldown blocks ✓
```

In practice JavaScript is single-threaded, so the race is between microtask/macrotask boundaries, not true threads. The actual risk is low. However, if `session_start` fires during an ongoing `agent_end` cooldown check, the delete resets the cooldown window — potentially triggering a second compaction run sooner than intended.

### Fix

Move `lastCompactionAt.delete(sid)` inside the `withSessionLock` call once D4-001 is fixed (i.e., once `session_start` acquires the lock).

---

## Lock Coverage Verification

Full enumeration of `registerTool` and `registerCommand` call sites and their lock status:

| Entry Point | Type | Lock? | File:Line |
|---|---|---|---|
| `load-steering-flow` | tool | ✅ `withSessionLock` | `index.ts:396` |
| `steering-flow-action` | tool | ✅ `withSessionLock` | `index.ts:420` |
| `save-to-steering-flow` | tool | ✅ `withSessionLock` | `index.ts:447` |
| `visualize-steering-flow` | tool | ✅ `withSessionLock` | `index.ts:468` |
| `get-steering-flow-info` | tool | ✅ `withSessionLock` | `index.ts:499` |
| `load-steering-flow` | command | ✅ `withSessionLock` | `index.ts:519` |
| `pop-steering-flow` | command | ✅ `withSessionLock` | `index.ts:534` |
| `save-to-steering-flow` | command | ✅ `withSessionLock` | `index.ts:560` |
| `visualize-steering-flow` | command | ✅ `withSessionLock` | `index.ts:600` |
| `get-steering-flow-info` | command | ✅ `withSessionLock` | `index.ts:618` |
| `steering-flow-action` | command | ✅ `withSessionLock` | `index.ts:641` |
| `agent_end` hook | hook | ✅ `withSessionLock` | `index.ts:677` |
| `session_start` hook | hook | ❌ **NO LOCK** | `index.ts:752` |

---

## `save-to-steering-flow` TOCTOU Analysis

**Conclusion: No TOCTOU.** The tool's `saveCall` function is called entirely inside `withSessionLock`. The sequence `readTape → modify → writeTape` executes atomically with respect to all other entry points that also use the lock. The read and write occur within the same critical section — no window exists between read and write where another writer could interleave.

---

## Parallel Tool Call Serialization Analysis

When Pi fires `load-steering-flow` and `steering-flow-action` in the same turn (parallel tool calls for the same sessionId):

1. Both calls invoke `withSessionLock(sessionId, fn)` concurrently.
2. Whichever call executes `sessionLocks.set(key, tail)` second chains its `fn` after the first's `tail` promise.
3. The second call's `fn` does not begin until the first's `tail` settles (whether via resolve or reject).
4. **Result:** the second call sees the fully committed state written by the first call (both `state.json` and `tape.json` flushed via `atomicWriteJson`/rename before lock release).

This is correct. The promise-chain mutex correctly serializes concurrent same-key calls in a single Node.js process.

---

## `withSessionLock` Cleanup Logic Analysis

The identity check in the `finally` block:

```typescript
// storage.ts:83-85
if (sessionLocks.get(key) === tail) {
    sessionLocks.delete(key);
}
```

**Correctness:** When N concurrent callers chain, each overwrites `sessionLocks.set(key, tailN)`. Only the *last* caller's `tail` sits in the Map at the time their `finally` runs. Each earlier caller's `finally` sees `tailI !== tailN` and skips the delete — correct. Only the last caller cleans up the Map entry. There is no double-delete and no premature delete.

**Edge case — exactly two concurrent callers:**

```
Caller A: prev=resolved, next_A=fn_A.chain, tail_A=next_A.settled, Map[key]=tail_A
Caller B: prev=tail_A,   next_B=fn_B.chain, tail_B=next_B.settled, Map[key]=tail_B
A finally: Map[key]===tail_B !== tail_A → skip delete  ✓
B finally: Map[key]===tail_B === tail_B → delete        ✓
```

The cleanup logic is sound.

---

## Recommendations (Priority Order)

1. **[CRITICAL — D4-001]** Wrap the entire `session_start` handler body in `withSessionLock(sid, ...)`. This is the only unguarded mutation path and the only CRITICAL finding.
2. **[MEDIUM — D4-002]** Add a reentrance guard to `withSessionLock` (a `Set<string>` of active keys, throw on re-entry) and document the non-reentrancy constraint with a JSDoc `@remarks` block.
3. **[LOW — D4-003]** Document that the session lock is single-process only. Add a runtime warning or README note that running two Pi processes against the same session directory is unsupported and may cause data corruption.
4. **[INFO — D4-004]** After D4-001 is fixed, move `lastCompactionAt.delete(sid)` inside the `withSessionLock` body in `session_start`.
