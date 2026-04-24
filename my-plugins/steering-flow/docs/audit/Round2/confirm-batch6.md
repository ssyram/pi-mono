# Audit Confirmation — Batch 6
**Reviewer**: fresh (no prior audit context read)
**Source files inspected**: `storage.ts`, `engine.ts`, `index.ts`
**Date**: 2026-04-23

---

## D5-001 (HIGH) — Migrated sessions: empty `flow_dir` causes wrong script resolution

**Verdict: CONFIRMED — mechanism description partially inaccurate, but the bug is real and the impact is correct.**

### Source trace

**`storage.ts` line 261** — `loadRuntime` materialises the runtime object:
```ts
flow_dir: struct.flow_dir ?? "",  // backward-compat: older on-disk records may lack it
```
Any on-disk FSM record written before `flow_dir` was added to the schema will deserialise as `undefined`, and the nullish-coalesce substitutes `""`.

**`engine.ts` lines 20-24** — `resolveTokenRelToFlow`:
```ts
function resolveTokenRelToFlow(token: string, flowDir: string): string {
    if (!flowDir) return token;           // ← empty string is falsy: early-return fires
    if (token.startsWith("./") || token.startsWith("../")) {
        return pathResolve(flowDir, token);
    }
    return token;
}
```
When `flowDir === ""` the guard `!flowDir` is `true`, so the function **returns the raw token unchanged** — it never reaches `pathResolve` at all.

**`engine.ts` lines 75-77** — call sites in `runCondition`:
```ts
const cmd = resolveTokenRelToFlow(interpolatePlaceholders(rawCmd, tapePath, namedArgs), flowDir);
args = args.map(a => resolveTokenRelToFlow(interpolatePlaceholders(a, tapePath, namedArgs), flowDir));
```
`runtime.flow_dir` is passed directly as `flowDir` (lines 245, 330 — `executeAction` and `chainEpsilon` / `enterStart` paths).

### Effect
A relative script token like `./check.mjs` is returned as-is. Node's `child_process.spawn` then resolves it against the process CWD, not the original YAML directory. The script is not found or the wrong file is executed. Conditions silently fail.

### Correction to claim's mechanism
The claim states that `path.resolve("", "./script.mjs")` is called and resolves to CWD. That is mechanically wrong — `pathResolve` is **never reached**. The `!flowDir` early-return on line 21 fires first, returning the raw relative string. The downstream effect (wrong resolution) is the same, but the call path is different.

### Verdict summary
- Bug exists: **YES**
- Impact is correct: **YES** (scripts not found / wrong CWD resolution)
- Mechanism description: **PARTIALLY INACCURATE** (early-return, not a `path.resolve("")` call)

---

## D5-002 (MEDIUM) — `popFsm` writes stack before removing FSM directory

**Verdict: CONFIRMED.**

### Source trace

**`storage.ts` lines 111-123** — `popFsm` in full:
```ts
export async function popFsm(sessionDir: string): Promise<string | undefined> {
    const stack = await readStack(sessionDir);
    const top = stack.pop();
    await writeStack(sessionDir, stack);      // ← (1) stack written first — FSM removed from index
    if (top) {
        try {
            await fs.rm(fsmDir(sessionDir, top), { recursive: true, force: true });  // ← (2) rm attempted second
        } catch {
            // Leave orphan on rm error; not fatal    // ← (3) rm failure silently swallowed
        }
    }
    return top;
}
```

### Operation order confirmed
1. `writeStack` persists the stack **without** the popped FSM ID — the FSM is now unreferenced in the index.
2. `fs.rm` is called in a separate `try` block.
3. If `fs.rm` throws (permissions, locked file, OS error), the `catch` block logs nothing and returns normally.

### Orphan path
There is no periodic GC, no re-scan of `sessionDir` to match directories against the stack, and no retry mechanism. An FSM directory that survives a failed `rm` is permanently orphaned. The only other `fs.rm` calls in the file (lines 149, 155) are in `sweepTmpFiles`, which targets only `.tmp` files — not FSM subdirectories.

### Verdict summary
- Operation order (write-then-rm): **CONFIRMED**
- Orphan scenario on rm failure: **CONFIRMED**
- No GC path: **CONFIRMED**

---

## D4-004 (GUARDED) — `enterStart` tape-rollback asymmetry guarded by `loadAndPush` cleanup

**Verdict: CONFIRMED — both halves of the claim verified.**

### Part A: `enterStart` has the same tape-rollback asymmetry

**`engine.ts`** — `enterStart` snapshots only `current_state_id`:
```ts
const snapshot = runtime.current_state_id;
// ...
// on epsilon failure:
runtime.current_state_id = snapshot;
```
Tape writes (if any condition script modified `tape.json`) are **not** rolled back — same asymmetry as `executeAction`. The `runtime.tape` in-memory object may diverge from the on-disk tape.

### Part B: `loadAndPush` catch block calls `popFsm`

**`index.ts` lines 175-200** — two distinct failure paths, both call `popFsm`:

```ts
// Path 1 — enterStart throws
try {
    entry = await enterStart(rt, tapePath, cwd);
    rt.tape = await readTape(sessionDir, fsmId);
} catch (e) {
    await popFsm(sessionDir);          // ← line 180: explicit cleanup on exception
    return { ok: false, error: `...` };
}

// Path 2 — enterStart returns but epsilon chain failed
if (!entry.success) {
    await popFsm(sessionDir);          // ← line 190: explicit cleanup on soft failure
    return { ok: false, error: `...` };
}
```

There is also a third `popFsm` call at line 200 for the `reached_end` case (immediate $END on load), and at line 250 — all are explicit cleanup before returning.

### Part C: `popFsm` deletes the FSM directory

Confirmed above (D5-002 trace) — `fs.rm(fsmDir(...), { recursive: true, force: true })` deletes the entire FSM subdirectory.

### Why the guard works (and its limit)
Because `loadAndPush` calls `popFsm` before returning an error, the half-initialised FSM is removed from both the stack index and the filesystem. The tape-rollback asymmetry is therefore not observable to callers — the entire FSM state is destroyed rather than left inconsistent.

**Residual risk**: As established in D5-002, `popFsm`'s `rm` can silently fail, leaving the orphaned FSM directory on disk even though it is no longer in the stack index. The guard therefore only partially mitigates the asymmetry.

### Verdict summary
- `loadAndPush` catch calls `popFsm`: **CONFIRMED** (lines 180, 190, 200, 250)
- `popFsm` deletes FSM dir: **CONFIRMED** (`fs.rm recursive`)
- Finding classified as GUARDED: **CONFIRMED** (cleanup is real, but guard has its own weakness per D5-002)

---

## D3-005 (PARTIAL) — `agent_end` stagnation tracking swallowed by outer try/catch

**Verdict: CONFIRMED.**

### Source trace

**`index.ts` line 636-723** — `agent_end` hook structure:
```
pi.on("agent_end", async (event, ctx) => {
    try {                                          // ← line 637: outer swallowing try
        ...
        await withSessionLock(sessionId, async () => {
            ...
            const prevCount = stateFile?.reminder_count ?? 0;   // line 687
            const nextCount = prevHash === hash ? prevCount + 1 : 1; // line 688
            ...
            await writeState(sessionDir, fsmId, currentStateId, tapeData, {
                reminder_count: nextCount,         // ← bare await, no inner try/catch
                last_reminder_hash: hash,
            });
        });
    } catch {                                      // ← line 723: silent swallow
        // Hooks must never throw
    }
});
```

### Error propagation path
1. `writeState` throws (e.g. disk full, lock contention, permission error).
2. Exception propagates out of the `withSessionLock` callback.
3. `withSessionLock` re-throws (it does not catch internally for writeState calls).
4. Exception reaches the outer `try` at line 637.
5. Caught at line 723 — `catch {}` — no log, no notify, no rethrow.

### Stagnation freeze
`reminder_count` was not incremented on disk. On the next `agent_end` invocation, `stateFile?.reminder_count` reads the old value. `nextCount` increments it by 1 again — but the write fails again. The counter never advances past the last successfully persisted value. `STOP_HOOK_STAGNATION_LIMIT = 3` (line 44) is never reached. Reminders continue indefinitely.

### Scope of "PARTIAL" classification
The claim is correct in all respects. The "partial" qualifier presumably reflects that the failure requires a persistent `writeState` error (unusual in normal operation) rather than being a logic bug that fires unconditionally. From source alone, the mechanism is fully confirmed.

### Verdict summary
- `writeState` for `reminder_count` is inside swallowing try/catch: **CONFIRMED**
- Counter freezes on persistent writeState failure: **CONFIRMED**
- Stagnation limit never reached → infinite reminders: **CONFIRMED**

---

## Summary table

| Finding | Severity | Verdict | Notes |
|---|---|---|---|
| D5-001 | HIGH | **CONFIRMED** | Mechanism partially misdescribed: early-return fires, not `path.resolve("")`; effect is identical |
| D5-002 | MEDIUM | **CONFIRMED** | writeStack-before-rm order confirmed; rm failure silently orphans FSM directory |
| D4-004 | GUARDED | **CONFIRMED** | Both load-failure paths call `popFsm`; guard is real but inherits D5-002's rm-failure risk |
| D3-005 | PARTIAL | **CONFIRMED** | Bare `writeState` awaits inside outer swallowing catch; stagnation counter freezes on disk error |
