# Crash Safety Audit — Round 3

**Dimension**: Crash safety (persistence ordering, atomic writes, recovery)
**Spec**: `docs/execution-behavior.md`
**Source files audited**: `storage.ts`, `index.ts`, `engine.ts`, `types.ts`, `parser.ts`, `stop-guards.ts`, `builtin-registry.ts`, `builtins/*.mjs`
**Date**: 2026-04-23

---

## Notation

- **PRE(op)** / **POST(op)**: precondition / postcondition of operation `op`
- **INV(x)**: invariant `x` that must hold across crash boundaries
- Classification: VULNERABLE (exploitable), LEAK (resource leak), PARTIAL (partially guarded), GUARDED (defended but with caveats), SAFE/PROVEN (no issue)

---

## Finding 1: `loadAndPush` writes state BEFORE tape — inverts tape-first invariant

**Classification**: VULNERABLE

**Invariant violated**: INV(tape-first) — "tape 先（数据），state 後（提交标記）" (spec §H.2)

**Location**: `index.ts:158-159`

```ts
await writeState(sessionDir, fsmId, "$START", []);   // line 158
await writeTape(sessionDir, fsmId, {});               // line 159
```

**Spec claim** (§H.2): `persistRuntime` writes tape first, state second. Crash between the two → old state + new tape → "transition didn't happen but tape data is in place" → at-least-once retry semantics.

**Violation**: `loadAndPush` writes `state.json` (with `$START`) BEFORE `tape.json` (with `{}`). This is the inverse of the tape-first ordering that `persistRuntime` enforces.

**Counterexample**: Process crashes after `writeState` at line 158 but before `writeTape` at line 159. On recovery:
1. `fsm.json` exists (written at line 157)
2. `state.json` exists with `current_state_id: "$START"`
3. `tape.json` does NOT exist
4. `stack.json` does NOT contain this `fsmId` (pushFsm at line 160 hasn't run)

Since `stack.json` doesn't reference this FSM, the orphaned `fsm.json` + `state.json` are invisible to the system — the FSM directory is leaked but never loaded. This is a resource leak, not a data corruption issue, because `pushFsm` hasn't committed the FSM to the stack yet.

However, if the crash occurs after line 160 (`pushFsm`) but before `enterStart` completes, `loadRuntime` (storage.ts:253) will load the FSM with `state.json=$START` and `tape={}` (default for missing tape.json) — which is actually a valid initial state. So the ordering inversion in lines 158-159 is benign in practice because both files contain initial/default values.

**Severity**: Low. The inversion violates the stated invariant but the initial values (`$START`, `{}`) are idempotent — recovery produces a valid initial state regardless of which file landed first. The real risk is the orphaned directory (see Finding 4).

---

## Finding 2: Crash window between `persistRuntime` and `popFsm` on `$END`

**Classification**: VULNERABLE

**Invariant violated**: POST(reached_end) — "FSM 目录已删；stack 已 pop" (spec §O)

**Locations**:
- `index.ts:197-200` (loadAndPush path)
- `index.ts:244-249` (actionCall path)

```ts
// actionCall path (index.ts:244-249):
if (result.success) {
    await persistRuntime(sessionDir, rt);   // line 244 — state now at $END
}
// ...
if (result.reached_end) {
    await popFsm(sessionDir);               // line 249 — crash here = $END on stack
```

**Counterexample**: `actionCall` transitions to `$END`. `persistRuntime` succeeds at line 244 (state.json now has `current_state_id: "$END"`). Process crashes before `popFsm` at line 249.

On recovery:
1. `stack.json` still contains this `fsmId` as top
2. `state.json` has `current_state_id: "$END"`
3. Stop hook loads runtime, sees `$END`, returns early (line ~683: `if (rt.current_state_id === "$END") return`)
4. Any `actionCall` loads runtime at `$END` — no actions available, user gets stuck
5. No automatic recovery mechanism pops the completed FSM

**Impact**: The FSM is permanently stuck on the stack at `$END`. The stop hook won't fire reminders (it early-returns on `$END`). The user must manually `/pop-steering-flow` to recover. The spec's §O invariant ("到達 $END → FSM 目录已删；stack 已 pop") is violated.

**Severity**: Medium. Not data corruption, but the system enters a stuck state requiring manual intervention.

---

## Finding 3: `saveCall` writes tape without state — tape drifts ahead of state

**Classification**: PARTIAL

**Invariant violated**: INV(tape-first) semantic intent — tape and state should represent a consistent snapshot

**Location**: `index.ts:281`

```ts
tape[id] = value;
await writeTape(sessionDir, fsmId, tape);   // line 281 — no writeState follows
```

**Spec** (§H.3): `saveCall` writes tape only. This is by design — `saveCall` is a data-only mutation that doesn't advance the FSM state.

**Analysis**: `saveCall` intentionally writes tape without a corresponding state write. If the process crashes after `writeTape` but before the next `persistRuntime` (which would be in a subsequent `actionCall`), the tape contains data that was never "committed" by a state transition.

**Counterexample**: User calls `save-to-steering-flow key=value`, tape.json is updated. Process crashes. On recovery, `loadRuntime` reads the updated tape + old state. A condition script that reads tape sees the saved value, but the FSM state hasn't advanced. If the condition is idempotent, this is fine. If the condition has side effects based on tape values, it may execute with unexpected data.

**Severity**: Low. This is a documented design choice (§H.3), not an oversight. The tape-first invariant from §H.2 applies specifically to `persistRuntime`'s transition commit protocol, not to `saveCall`. However, the spec does not explicitly document the crash semantics of `saveCall` — it only documents the happy path.

---

## Finding 4: `loadAndPush` crash between file writes and `pushFsm` — orphaned FSM directory

**Classification**: LEAK

**Invariant violated**: POST(failed_load) — "stack 不变（已回滚）；FSM 目录已删" (spec §O)

**Location**: `index.ts:157-160`

```ts
await writeFsmStructure(sessionDir, fsmId, ...);  // line 157
await writeState(sessionDir, fsmId, "$START", []); // line 158
await writeTape(sessionDir, fsmId, {});             // line 159
await pushFsm(sessionDir, fsmId);                  // line 160
```

**Counterexample**: Process crashes after `writeFsmStructure` (line 157) but before `pushFsm` (line 160). On recovery:
1. FSM directory exists with `fsm.json` (and possibly `state.json`, `tape.json`)
2. `stack.json` does NOT reference this `fsmId`
3. The directory is invisible to all operations (load, action, info, pop)
4. `sweepTmpFiles` (storage.ts:142) only cleans `.tmp.*` files, not orphaned FSM directories

**Impact**: Disk space leak. Each crashed `loadAndPush` leaves an orphaned `<timestamp>-<slug>-<hex>/` directory with up to 3 JSON files. No cleanup mechanism exists.

**Severity**: Low. Orphaned directories are small (< 10KB) and accumulate only on crashes during load, which is rare. But there is no garbage collection path — they persist forever.

---

## Finding 5: `popFsm` crash between `writeStack` and `fs.rm` — orphaned FSM directory

**Classification**: LEAK (GUARDED by design)

**Invariant violated**: POST(pop) — "FSM 目录已删" (spec §O)

**Location**: `storage.ts:111-126`

```ts
export async function popFsm(sessionDir: string): Promise<string | undefined> {
    const stack = await readStack(sessionDir);
    const top = stack.pop();
    await writeStack(sessionDir, stack);        // stack updated — FSM removed
    if (top) {
        try {
            await fs.rm(fsmDir(sessionDir, top), { recursive: true, force: true });
        } catch {
            // Leave orphan on rm error; not fatal
        }
    }
    return top;
}
```

**Analysis**: `popFsm` writes the updated stack FIRST, then attempts to delete the FSM directory. Crash after `writeStack` but before `fs.rm` leaves an orphaned directory. The code explicitly catches `rm` errors and comments "Leave orphan on rm error; not fatal."

**Severity**: Minimal. This is a deliberate design choice — stack consistency is prioritized over directory cleanup. The orphan is identical to Finding 4 (invisible, small, no cleanup path). The comment shows this was considered.

---

## Finding 6: `readJsonStrict` throws `CorruptedStateError` on truncated JSON — no recovery path

**Classification**: PARTIAL

**PRE(readJsonStrict)**: File exists and contains valid JSON
**POST(readJsonStrict)**: Returns parsed object OR undefined (ENOENT) OR throws CorruptedStateError

**Location**: `storage.ts:45-57`

```ts
async function readJsonStrict<T>(path: string): Promise<T | undefined> {
    let text: string;
    try {
        text = await fs.readFile(path, "utf-8");
    } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return undefined;
        throw e;
    }
    try {
        return JSON.parse(text) as T;
    } catch (e) {
        throw new CorruptedStateError(path, e);
    }
}
```

**Analysis**: `atomicWriteJson` uses tmp+rename, which is POSIX-atomic on the same filesystem. Under normal operation, `readJsonStrict` should never encounter truncated JSON because `rename` is atomic. However:

1. **Cross-filesystem rename**: If `sessionDir` is on a different filesystem than the tmp file location (same directory, so this shouldn't happen — but `fs.rename` falls back to copy+delete on cross-fs, which is NOT atomic on all Node.js versions).
2. **Non-POSIX filesystems**: Network mounts (NFS, SMB), some container overlayfs configurations — `rename` may not be atomic.
3. **External corruption**: Manual editing, disk errors, incomplete rsync/copy.

When `CorruptedStateError` is thrown:
- **Tool calls**: Caught by outer try/catch, returns friendly error message to user (spec §M)
- **Stop hook**: Caught by inner try/catch, notifies via `ctx.ui.notify` if UI available (index.ts:~670)
- **`loadRuntime`**: Propagates up — caller must handle

**Missing**: No automatic recovery from corrupted files. No "delete and re-initialize" fallback. No backup/shadow copy mechanism. The user must manually delete the corrupted file or the entire FSM directory.

**Severity**: Medium. The error is surfaced cleanly, but recovery requires manual intervention. Given that `atomicWriteJson` makes corruption extremely unlikely on POSIX, this is acceptable — but the spec should document the recovery procedure.

---

## Finding 7: `pushFsm` / `popFsm` non-atomic read-modify-write on `stack.json`

**Classification**: GUARDED

**INV(stack-consistency)**: `stack.json` always reflects the true set of active FSMs

**Location**: `storage.ts:105-108` (pushFsm), `storage.ts:111-126` (popFsm)

```ts
export async function pushFsm(sessionDir: string, fsmId: string): Promise<void> {
    const stack = await readStack(sessionDir);   // READ
    stack.push(fsmId);                           // MODIFY
    await writeStack(sessionDir, stack);         // WRITE
}
```

**Analysis**: Both `pushFsm` and `popFsm` perform a non-atomic read-modify-write cycle on `stack.json`. This is protected by `withSessionLock` (in-process async mutex) which serializes all operations per session.

**Crash scenario**: Process crashes after `readStack` but before `writeStack` — no harm, stack unchanged. Process crashes during `writeStack` — `atomicWriteJson` ensures either old or new content survives (tmp+rename). This is safe.

**Cross-process scenario**: Two processes operating on the same session simultaneously. `withSessionLock` is in-process only (Map-based). Concurrent `pushFsm` from two processes → lost update. `atomicWriteJson` prevents corruption (no torn writes) but one push would be silently lost.

**Severity**: Low. Cross-process concurrent access is explicitly documented as not covered (spec §N: "跨进程...原子写入防损坏但不防丢失更新"). In-process access is properly serialized.

---

## Finding 8: `writeState` with `preserve_entered_at` — TOCTOU read-then-write

**Classification**: GUARDED

**Location**: `storage.ts:220-224`

```ts
if (reminderMeta?.preserve_entered_at) {
    const existing = await readState(sessionDir, fsmId);
    if (existing?.entered_at) enteredAt = existing.entered_at;
}
// ... then atomicWriteJson(state.json, payload)
```

**Analysis**: `writeState` reads the existing `state.json` to preserve `entered_at`, then writes a new `state.json`. Between the read and write, another operation could modify `state.json`. This is a classic TOCTOU pattern.

**Guard**: All callers of `writeState` with `preserve_entered_at: true` are inside `withSessionLock` (the stop hook at index.ts:~656). The session lock serializes this read-then-write, making the TOCTOU unexploitable within a single process.

**Severity**: None in practice. The TOCTOU is fully guarded by `withSessionLock`. Cross-process races are out of scope per spec §N.

---

## Finding 9: `loadAndPush` rollback via `popFsm` — compound failure on disk-full

**Classification**: LEAK

**Invariant violated**: POST(failed_load) — "stack 不变（已回滚）；FSM 目录已删" (spec §O)

**Location**: `index.ts:179-183`

```ts
} catch (e) {
    await popFsm(sessionDir);
    return { ok: false, error: `Flow '${flowName}' failed during $START entry; stack rolled back.` };
}
```

**Analysis**: When `enterStart` throws, `loadAndPush` calls `popFsm` to roll back. `popFsm` (storage.ts:111) pops the stack and then does `fs.rm` on the FSM directory. This SHOULD clean up completely.

**But**: If `popFsm` itself fails (e.g., `writeStack` throws due to disk full), the error propagates up from `popFsm`, the `return { ok: false, ... }` is never reached, and the tool's outer try/catch handles it. The stack may or may not have been updated depending on where `popFsm` failed.

**Counterexample**: `enterStart` throws → `popFsm` called → `readStack` succeeds → `stack.pop()` → `writeStack` fails (disk full) → `popFsm` throws → `loadAndPush` catch doesn't return cleanly → outer handler catches. Stack still contains the fsmId, but the FSM is in an indeterminate state (partially initialized, enterStart failed).

**Severity**: Low. Requires disk-full during rollback — a compound failure. The FSM would be on the stack with `$START` state, and the next `actionCall` would attempt to operate on it normally (which may or may not work depending on what `enterStart` was doing).

---

## Finding 10: `atomicWriteJson` — no `fsync` before rename

**Classification**: PARTIAL

**INV(durability)**: Written data survives power loss

**Location**: `storage.ts:37-41`

```ts
async function atomicWriteJson(path: string, data: unknown): Promise<void> {
    const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
    const text = JSON.stringify(data, null, 2);
    await fs.writeFile(tmp, text, "utf-8");
    await fs.rename(tmp, path);
}
```

**Analysis**: The pattern is `writeFile(tmp)` → `rename(tmp, path)`. On POSIX, `rename` is atomic for metadata, but without `fsync` on the file descriptor before rename AND `fsync` on the directory after rename, the data may not be durable after a power loss (kernel may reorder writes).

Classic safe pattern:
1. `writeFile(tmp)`
2. `fsync(tmp)` ← missing
3. `rename(tmp, path)`
4. `fsync(directory)` ← missing

Without `fsync`, a power failure (not process crash) could result in:
- `rename` visible but file content is zero-length or garbage (kernel wrote metadata but not data)
- Both old and new file lost (directory entry updated but neither data block flushed)

**Severity**: Low for this use case. This plugin runs inside a long-lived Node.js process (pi agent). Process crashes (SIGKILL, OOM, unhandled exception) are the primary crash mode, not power failures. For process crashes, the kernel flushes dirty pages on its own schedule, and `rename` atomicity is sufficient. Power-loss durability would require `fsync`, but the added latency is likely not worth it for a development tool.

---

## Summary Table

| # | Finding | Location | Classification | Severity |
|---|---|---|---|---|
| 1 | `loadAndPush` inverts tape-first ordering | index.ts:158-159 | VULNERABLE | Low |
| 2 | Crash window: `persistRuntime` → `popFsm` on $END | index.ts:197-200, 244-249 | VULNERABLE | Medium |
| 3 | `saveCall` tape-only write — no crash semantics documented | index.ts:281 | PARTIAL | Low |
| 4 | `loadAndPush` crash before `pushFsm` — orphaned FSM dir | index.ts:157-160 | LEAK | Low |
| 5 | `popFsm` crash between stack write and `fs.rm` — orphaned dir | storage.ts:111-126 | LEAK (by design) | Minimal |
| 6 | `readJsonStrict` throws on corruption — no auto-recovery | storage.ts:45-57 | PARTIAL | Medium |
| 7 | `pushFsm`/`popFsm` non-atomic RMW — cross-process unsafe | storage.ts:105-126 | GUARDED | Low |
| 8 | `writeState` preserve_entered_at TOCTOU | storage.ts:220-224 | GUARDED | None |
| 9 | `popFsm` failure during rollback — compound failure | index.ts:179-183 | LEAK | Low |
| 10 | `atomicWriteJson` missing `fsync` — power-loss durability | storage.ts:37-41 | PARTIAL | Low |

---

## Conclusions

**Tape-first ordering** (Focus 1): Enforced in `persistRuntime` (index.ts:109-110) but inverted in `loadAndPush` (index.ts:158-159). The inversion is benign because initial values are idempotent, but it violates the stated invariant.

**Atomic write correctness** (Focus 2): `atomicWriteJson` correctly implements tmp+rename. Missing `fsync` means power-loss (not process-crash) durability is not guaranteed. Acceptable for a dev tool.

**Crash between tape and state writes** (Focus 3): `persistRuntime`'s tape-first ordering provides correct at-least-once semantics for transitions. The stop hook's state-only write (reminder metadata) is safe because it doesn't modify tape — crash leaves old reminder count, which simply resets the stagnation counter.

**Stack.json consistency after push/pop crashes** (Focus 4): `atomicWriteJson` prevents torn writes. The RMW cycle is guarded by `withSessionLock` in-process. The main risk is Finding 2 — a completed FSM ($END) stuck on the stack after crash between `persistRuntime` and `popFsm`.

**`readJsonStrict` error handling** (Focus 5): Clean error surfacing via `CorruptedStateError`. No automatic recovery — manual intervention required. Corruption is extremely unlikely given atomic writes on POSIX.

**Load failure rollback** (Focus 6): `popFsm` rollback works correctly in the common case. Compound failures (disk full during rollback) can leave the stack in an inconsistent state (Finding 9). Orphaned directories from pre-`pushFsm` crashes are never cleaned up (Finding 4).
