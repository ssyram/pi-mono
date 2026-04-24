# Batch 5 — Independent Audit Confirmation (D4-001, D4-002, D4-003, D4-004, D4-006, D3-005)

**Reviewer**: Fresh — source-only trace, no prior batch notes consulted  
**Files read**: `engine.ts`, `index.ts`, `storage.ts` (full)  
**Date**: 2026-04-23  
**Priority class**: D4 findings (zero prior coverage), one D3 revisit

---

## Finding D4-001 — CONFIRMED (CRITICAL)

**Claim**: When an epsilon chain fails partway (A→B succeeds, B→C fails), the rollback restores only `runtime.current_state_id`; tape mutations accumulated during the B→C condition execution are **never rolled back**.

### Trace

**engine.ts — `executeAction`:**

```
L245:  condResult = await runCondition(act.condition, tapePath, …)   ← initial condition runs, may write tape
L259:  const snapshotStateId = runtime.current_state_id;             ← snapshot: state ID only, NOT tape
L283:  await chainEpsilon(runtime, tapePath, …)                       ← epsilon chain runs (see D4-002)
L286:  runtime.current_state_id = snapshotStateId;                   ← ROLLBACK: only state ID restored
```

No `writeTape` or `readTape` call anywhere in the rollback branch. The tape file on disk is never touched during rollback.

**index.ts — `actionCall`:**

```
L234-235:  executeAction(rt, tapePath, …)
L237:      rt.tape = await readTape(…)          ← re-syncs in-memory tape FROM disk (persists dirty tape)
L241:      // "executeAction rolls back runtime.current_state_id; we skip"
L244:      await persistRuntime(…)              ← gated on result.success; skipped on failure
```

The comment at L241 explicitly acknowledges only state ID is rolled back. After a failure, `readTape` at L237 re-syncs the in-memory `rt.tape` from the already-mutated `tape.json` on disk — the dirty tape becomes the new truth.

**storage.ts**: `writeTape` (L247-250) uses `atomicWriteJson`. There is no rollback wrapper, no "old tape" snapshot stored anywhere before conditions run.

### Verdict: **CONFIRMED**

The rollback window covers `runtime.current_state_id` (a string) and nothing else. Tape mutations from conditions in any hop of a failing epsilon chain persist permanently in `tape.json`.

---

## Finding D4-002 — CONFIRMED (CRITICAL)

**Claim**: During a partial N-hop epsilon chain, tape ends up at the Nth hop's post-condition state rather than the pre-chain state. Each hop's condition can write to `tape.json`; these writes are never rolled back.

### Trace

**engine.ts — `chainEpsilon` (lines 314–355):**

```
L314:  while (true) {
L330:    condResult = await runCondition(act.condition, tapePath, …)  ← condition runs; may write tape.json
L349:    runtime.current_state_id = matched.next_state_id;            ← state advanced
         // loop continues to next hop
       }
```

There is **no tape snapshot taken before the loop**, **no tape saved at any iteration**, and **no tape restore on loop exit (success or failure)**. The function signature is `chainEpsilon(runtime, tapePath, …): Promise<ChainResult>` — it receives `tapePath` only to pass to `runCondition`, never to read/write a snapshot.

After the loop breaks on a failed condition:

- `engine.ts L286`: `runtime.current_state_id = snapshotStateId` — state rolled back to pre-chain value
- Tape file: unchanged — it retains all writes from hops 1 through N-1 that succeeded

The tape ends up at precisely the state after the last **successful** hop's condition, not the pre-chain state.

### Verdict: **CONFIRMED**

The bug is structural: `chainEpsilon` has no tape lifecycle management whatsoever. Each condition call is a fire-and-forget side-effect on the file system.

---

## Finding D4-003 — CONFIRMED (HIGH)

**Claim**: In `executeAction`, the initial (non-epsilon) action's condition can mutate tape **before** the state snapshot is taken. The snapshot therefore does not capture the pre-condition tape state, and even if tape were included in the snapshot it would be too late.

### Trace

**engine.ts — `executeAction` (order of operations):**

```
L245:  condResult = await runCondition(act.condition, tapePath, …)  ← (1) condition executes; tape writable NOW
         …
L259:  const snapshotStateId = runtime.current_state_id;            ← (2) snapshot taken AFTER condition
```

The gap between L245 and L259 is 14 lines of post-condition processing (result checking, transition matching). The snapshot is taken only after the condition succeeds.

Two consequences:
1. If the condition writes to tape then the transition fails for any other reason, the tape mutation is already committed before the snapshot line is reached.
2. Even if the snapshot were moved before L245, it captures only a string (`current_state_id`), not tape content — there is no tape snapshot primitive anywhere in the codebase.

### Verdict: **CONFIRMED**

The condition runs at L245; the snapshot is taken at L259. Any tape mutation from the condition escapes both the snapshot and any subsequent rollback.

---

## Finding D4-004 — CONFIRMED LATENT-ONLY (GUARDED)

**Claim**: `enterStart` has the same tape asymmetry as `executeAction`, but it is currently safe because `loadAndPush`'s rollback (`popFsm`) deletes the entire FSM directory, wiping any tape mutations. The risk is latent, not live.

### Trace

**engine.ts — `enterStart`:**

```
L363:  const snapshot = runtime.current_state_id;       ← state snapshot only
L367:  runtime.current_state_id = snapshot;             ← rollback: state ID only (same pattern as D4-001)
```

If `enterStart` fails after a condition has written to the FSM's `tape.json`, the engine-level rollback is incomplete — identical gap to D4-001.

**index.ts — `loadAndPush`:**

```
L180:  await popFsm(sessionDir)   ← on enterStart exception
L190:  await popFsm(sessionDir)   ← on !entry.success
```

**storage.ts — `popFsm` (L118):**

```typescript
fs.rm(fsmDir(sessionDir, top), { recursive: true, force: true })
```

`fsmDir` is the directory `<SESSION_DIR>/<FSM_ID>/`. The tape file lives at `<SESSION_DIR>/<FSM_ID>/tape.json`. `fs.rm` with `{ recursive: true }` deletes the entire directory tree — tape.json is destroyed along with everything else.

**Result**: Any tape mutations written during a failing `enterStart` condition are wiped by the recursive directory deletion. The engine-level rollback gap (state-only) is masked at the storage layer by a blunt-instrument deletion.

**The latency risk**: If `enterStart` is ever refactored to use a non-destructive `popFsm` (e.g., soft-pop that only removes from the stack), the tape asymmetry in engine.ts becomes a live bug identical to D4-001. The engine-level gap is real; it is currently papered over by a storage-layer side effect.

### Verdict: **CONFIRMED LATENT-ONLY** — Gap exists in engine.ts (L363/367); masked in production by `popFsm`'s recursive directory deletion (storage.ts L118). Requires engine-level fix for correctness-by-design.

---

## Finding D4-006 — CONFIRMED (MEDIUM)

**Claim**: Condition processes write to `tape.json` via the raw `$TAPE_FILE` path. They use their own `fs.writeFileSync`, not `atomicWriteJson`. A SIGKILL on timeout can truncate `tape.json`.

### Trace

**engine.ts — `interpolatePlaceholders`:**

```
L43:  if (key === "$TAPE_FILE") return tapePath;   ← raw file path returned as-is
```

`tapePath` is the string `<SESSION_DIR>/<FSM_ID>/tape.json`. It is substituted literally into the condition process's command-line arguments. The condition process receives the path and can do anything with it.

**engine.ts — `runCondition` (timeout/SIGKILL path):**

```
// on 30-second timeout:
process.kill(-childPid, "SIGKILL")   ← kills process group; no flush, no cleanup
```

`SIGKILL` is unblockable. If the condition process is mid-write to `tape.json` (e.g., partway through a `writeFileSync` that issued multiple `write(2)` syscalls for a large JSON), the file is left truncated.

**storage.ts — `writeTape` (L247-250):**

```typescript
await atomicWriteJson(tapePath, tape)
// atomicWriteJson: write to tmp file → rename (POSIX atomic)
```

The plugin's own tape writes use `atomicWriteJson` (tmp+rename), which is POSIX-atomic. But condition processes bypass `writeTape` entirely — they hold only a path string and write however they choose.

**The gap**: Atomicity is enforced at the `writeTape` call site in the plugin process. Condition processes are external and unconstrained. A SIGKILL between `open(tape.json, O_WRONLY|O_TRUNC)` and `close()` in the condition process leaves a truncated (zero-byte or partial) `tape.json`. The next `readTape` call will throw a JSON parse error.

### Verdict: **CONFIRMED** — `$TAPE_FILE` is a raw path (engine.ts L43). Condition processes bypass `atomicWriteJson`. SIGKILL on timeout (30s) can truncate `tape.json`. No recovery mechanism exists.

---

## Finding D3-005 — CONFIRMED (PARTIAL re-verification)

**Claim**: In the `agent_end` hook, stagnation tracking calls `writeState` to increment `reminder_count`. This `writeState` is inside a swallowed `catch`. If `writeState` fails (ENOSPC), the stagnation counter freezes and the user gets infinite reminders.

### Trace

**index.ts — `agent_end` hook (L636+):**

```
L636:  hooks.agent_end = async () => {
         try {
           …
           await withSessionLock(sessionDir, async () => {
             …
L699:          await writeState(sessionDir, fsmId, rt)   ← stagnation limit reset
               …
L707:          await writeState(sessionDir, fsmId, rt)   ← stagnation counter increment
           })
         } catch {
           // Hooks must never throw             ← EMPTY CATCH — swallows everything
         }
       }
```

Both `writeState` calls at L699 and L707 are:
1. Inside `withSessionLock` (which itself can throw on lock contention)
2. Inside the outer `try { } catch { }` block with an empty catch body

If `writeState` at L707 throws `ENOSPC` (disk full):
- The exception propagates up through `withSessionLock`
- Caught by the outer empty catch
- `rt.reminder_count` was incremented in memory, but the incremented value was never written to disk
- Next `agent_end` call reads the un-incremented value from disk — counter is frozen at its last successfully persisted value
- The stagnation prompt fires on every subsequent turn until disk space is freed

**storage.ts — `writeState` (L230):** Uses `atomicWriteJson` (tmp+rename). The tmp write itself can fail with ENOSPC before the rename — no partial rename, but the in-memory mutation is lost.

### Verdict: **CONFIRMED** — Both stagnation `writeState` calls are inside the swallowing `agent_end` catch. ENOSPC silently freezes the counter. The user receives infinite stagnation reminders with no diagnostic output.

---

## Summary Table

| Finding | Severity | Verdict | Key Evidence |
|---------|----------|---------|--------------|
| D4-001 | CRITICAL | ✅ CONFIRMED | `engine.ts:286` restores only `snapshotStateId`; no `writeTape` in rollback; `index.ts:237` re-syncs dirty tape from disk |
| D4-002 | CRITICAL | ✅ CONFIRMED | `engine.ts:314–355` (`chainEpsilon`) has zero tape snapshot/restore; `runCondition` at L330 writes tape per hop |
| D4-003 | HIGH | ✅ CONFIRMED | `runCondition` at `engine.ts:245` precedes `snapshotStateId` assignment at L259 by 14 lines; snapshot never includes tape |
| D4-004 | GUARDED | ✅ CONFIRMED LATENT | Engine gap same as D4-001 (L363/367); masked by `popFsm` recursive dir deletion (`storage.ts:118`); latent risk on refactor |
| D4-006 | MEDIUM | ✅ CONFIRMED | `$TAPE_FILE` → raw path at `engine.ts:43`; SIGKILL at timeout; conditions bypass `atomicWriteJson` (`storage.ts:247`) |
| D3-005 | PARTIAL | ✅ CONFIRMED | Both `writeState` calls for stagnation at `index.ts:699,707` inside empty `agent_end` catch; ENOSPC silently swallowed |

**All 6 findings confirmed from source. No false positives detected.**
