# Batch 5 Audit — Independent Confirmation Report

**Reviewer**: Fresh independent reviewer (no prior audit context read)  
**Date**: 2026-04-24  
**Sources read**: `index.ts`, `engine.ts`, `storage.ts`, `stop-guards.ts`  
**Audit docs read**: None (per task constraints)

---

## D5-001 (HIGH) — `writePendingPop` before `persistRuntime` in `actionCall`

**Verdict: CONFIRMED**

**Evidence** (`index.ts:258-264`):

```ts
if (result.reached_end) await writePendingPop(sessionDir, fsmId);  // line 258
await persistRuntime(sessionDir, rt);                               // line 259
// catch(persistErr):
//   console.error(...)
//   return { ... error string ... }                                 // no deletePendingPop
```

The ordering is exactly as described. `writePendingPop` writes `pending-pop.json` to disk at line 258. `persistRuntime` is called at line 259. If `persistRuntime` throws, the catch block at lines 260-264 logs and returns an error string — it never calls `deletePendingPop`. The marker file survives on disk while the FSM state was never persisted.

On next `session_start`, crash recovery at `index.ts:761-765` reads the marker and calls `popFsm` unconditionally — popping an FSM whose `$END` transition was never committed to disk.

**The finding is accurate. No mitigating code exists in the catch path.**

---

## D5-002 (HIGH) — `executeAction` mutates `current_state_id`; catch in `actionCall` does not roll back

**Verdict: PARTIALLY REJECTED — rollback exists, but scope is narrower than claimed**

**Evidence** (`engine.ts:257-286`):

```ts
const snapshotStateId = runtime.current_state_id;   // snapshot before mutation
// ...
runtime.current_state_id = action.next_state_id;    // mutation at line 268

// $END fast-path returns success here (no rollback needed)

const epsilonResult = await chainEpsilon(...);
if (!epsilonResult.ok) {
    runtime.current_state_id = snapshotStateId;     // rollback at line 286
    return { success: false, ... };
}
```

The audit claim that `current_state_id` is "NOT rolled back" is **incorrect for the epsilon-failure path** — line 286 explicitly restores `snapshotStateId`.

However, there is a **real but narrower divergence scenario**:

1. `executeAction` succeeds (returns `{ success: true, reached_end: false }`), `current_state_id` is now the new state in memory.
2. `persistRuntime` at `index.ts:259` fails.
3. The catch returns an error — no rollback of `current_state_id` occurs in `index.ts`.
4. In-memory `rt.current_state_id` = new state; disk `state.json` = old state.

But this in-memory `rt` is a local variable inside `actionCall` — it is not a long-lived singleton. The divergence only matters if `rt` is reused after the failed persist, which it is not in the current call flow (the function returns an error to the caller). The next operation will call `loadRuntime` from disk, which reads the old (correct) state.

**The finding overstates the risk.** The in-memory divergence is real but ephemeral — the local `rt` is discarded on error return. The disk state remains consistent (old state). The audit's framing implies persistent corruption; the actual impact is limited to the single failed call's return value.

**Verdict: REJECTED as stated. A narrower, real issue exists (see above) but it is not the crash-recovery divergence described.**

---

## D5-003 (HIGH) — Stop hook reads stale disk state after `persistRuntime` failure → premature stagnation

**Verdict: CONFIRMED**

**Evidence** (`index.ts:697-709`):

```ts
rt = await loadRuntime(sessionDir, topId);   // loads from disk
// ...
const hash = createHash("sha1")
    .update(rt.current_state_id + "\0" + stableStringify(rt.tape))
    .digest("hex");
const stateFile = await readState(sessionDir, topId);
const prevHash = stateFile?.last_reminder_hash;
const prevCount = stateFile?.reminder_count ?? 0;
const nextCount = prevHash === hash ? prevCount + 1 : 1;
```

`loadRuntime` reads from disk. If `persistRuntime` failed in a prior `actionCall`, disk still holds the pre-transition state. The stop hook computes a hash from that stale state. If the LLM stops again without a successful transition, the hash is identical to `prevHash` → `nextCount = prevCount + 1` → stagnation counter increments.

After enough increments the stop hook suppresses re-prompting (`index.ts:715`), causing the FSM to stall even though the LLM may have been making genuine progress (the action succeeded; only the persist failed).

**The finding is accurate. The stop hook has no awareness of whether the last persist succeeded.**

---

## D5-004 (HIGH) — Crash recovery pops FSM unconditionally from `pending-pop.json`, which can exist without successful persist

**Verdict: CONFIRMED**

**Evidence** (`index.ts:761-765`):

```ts
const pendingPop = await readPendingPop(dir);
if (pendingPop) {
    await popFsm(dir);
    await deletePendingPop(dir);
    ctx.ui.notify(`... Auto-popped FSM ${pendingPop.fsmId} (crash recovered ...)`, "warning");
}
```

The recovery logic is unconditional: if the marker file exists, pop. There is no check that the FSM's `state.json` actually reflects `$END`. Combined with D5-001 (marker written before persist), this creates the exact scenario described: `pending-pop.json` exists, `state.json` still has the pre-`$END` state, recovery pops the FSM as if it completed.

CS-2 Part A (lines 770-776) provides a complementary guard — it pops any stack-top FSM already at `$END` on disk. But this guard runs *after* Part B and does not compensate for Part B's false pop: Part B already popped the wrong FSM before Part A runs.

**The finding is accurate.**

---

## D5-005 (HIGH) — `persistRuntime` writes tape then state non-atomically; crash between writes leaves tape advanced with old state

**Verdict: CONFIRMED WITH QUALIFICATION**

**Evidence** (`index.ts:107-114`):

```ts
async function persistRuntime(sessionDir: string, rt: FSMRuntime): Promise<void> {
    // Write tape first, then state. state.json is effectively the commit
    // marker: if we crash between the two, the tape is already durable and
    // the state.current_state_id is unchanged from the previous successful
    // transition, so the next read sees a consistent (pre-transition) world.
    await writeTape(sessionDir, rt.fsm_id, rt.tape);
    await writeState(sessionDir, rt.fsm_id, rt.current_state_id, rt.transition_log);
}
```

The code comment explicitly acknowledges the non-atomic write and claims safety: "next read sees a consistent (pre-transition) world." The author's intent is that `state.json` acts as a commit marker — if it's not updated, the system treats the transition as not having happened.

The finding's concern is valid: tape is advanced (new values written) but `state.json` still points to the old state. On restart, `loadRuntime` reads old `current_state_id` with new tape values. Whether this causes re-execution depends on whether the action that produced those tape values is re-triggered.

The comment's "consistent pre-transition world" claim is **incomplete**: the tape is no longer in its pre-transition state. A state that reads tape variables will see post-transition tape values while believing it is in the pre-transition state. This is a real inconsistency, not a safe rollback.

**The finding is accurate. The code comment's safety argument is flawed — it conflates "state pointer unchanged" with "world is consistent," ignoring that tape has already been mutated.**

---

## Summary

| ID | Verdict | Confidence |
|---|---|---|
| D5-001 | **CONFIRMED** | High — exact code path traced, no mitigating catch |
| D5-002 | **PARTIALLY REJECTED** | High — rollback exists in engine.ts; ephemeral in-memory divergence is real but not the persistent corruption described |
| D5-003 | **CONFIRMED** | High — stop hook loads from disk, stale state produces identical hash |
| D5-004 | **CONFIRMED** | High — unconditional pop, no $END verification before popping |
| D5-005 | **CONFIRMED** | High — code comment's own safety argument is incomplete; tape/state inconsistency is real |
