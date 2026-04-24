# Audit Batch 4 — Independent Verification
**Reviewer**: Fresh reviewer (source-only, no prior audit docs read)
**Date**: 2026-04-23
**Scope**: D3-001, D3-002, D3-004, D3-006

---

## D3-001 — `persistRuntime` uncaught after `executeAction` success

**Claim**: In `index.ts` around line 244, `persistRuntime` is called after a successful `executeAction` without try/catch. If it throws, in-memory state has advanced but disk state has not — silent state regression on next load.

**Verdict**: ✅ CONFIRMED

**Evidence** (`index.ts` lines 235–250):

```ts
const result: TransitionResult = await executeAction(rt, actionId, args, tapePath, cwd);
rt.tape = await readTape(sessionDir, fsmId);
rt.transition_log = result.chain;

if (result.success) {
    await persistRuntime(sessionDir, rt);   // line 244 — no try/catch
}
```

`persistRuntime` (defined at line 104) writes `state.json` via `atomicWriteJson`. There is no try/catch around the call at line 244. If the write fails (disk full, permission error, etc.), the function continues: the caller receives a rendered success response, the in-memory `rt` reflects the new state, but `state.json` on disk still holds the pre-transition state. On next load, `loadRuntime` reads the stale disk state — silent regression confirmed.

Additionally, lines 250–258 show that if `result.reached_end`, `popFsm` is called immediately after — also without any guard on whether `persistRuntime` succeeded. The pop would remove the FSM directory while the disk state was never correctly written.

---

## D3-002 — `popFsm` rollback in `loadAndPush` catch block is itself unguarded

**Claim**: In `index.ts` `loadAndPush` (around lines 180, 190), the catch block calls `popFsm` for rollback but `popFsm` is not wrapped in try/catch. If `popFsm` throws, the original error is discarded.

**Verdict**: ✅ CONFIRMED

**Evidence** (`index.ts` lines 175–195):

```ts
try {
    entry = await enterStart(rt, tapePath, cwd);
    rt.tape = await readTape(sessionDir, fsmId);
} catch (e) {
    await popFsm(sessionDir);   // line 180 — bare await, no try/catch
    return {
        ok: false,
        error: `Flow '${flowName}' failed during $START entry; stack rolled back. Cause: ${e instanceof Error ? e.message : String(e)}`,
    };
}

if (!entry.success) {
    await popFsm(sessionDir);   // line 190 — bare await, no try/catch
    return {
        ok: false,
        error: `Flow '${flowName}' loaded but its initial epsilon chain from $START failed; ...`,
    };
}
```

`popFsm` (`storage.ts` lines 111–124) calls `writeStack` (line 114) which is an `await` with no internal error suppression — it can throw if the filesystem write fails. Neither call site (lines 180 or 190) wraps `popFsm` in try/catch. If `popFsm` throws:

1. The original error `e` (or the epsilon failure reason) is lost entirely — the exception from `popFsm` propagates up instead.
2. The stack may be left in an inconsistent state (the FSM was pushed but the pop failed mid-way through `writeStack`).

The `fs.rm` inside `popFsm` is itself wrapped in try/catch (lines 117–120), so the rm path is safe — but the `writeStack` call at line 114 is not, and that is the dangerous path.

---

## D3-004 — `chainEpsilon` discards per-condition rejection reasons

**Claim**: `engine.ts` `chainEpsilon` (around line 337) discards per-condition rejection reasons. When all epsilon conditions fail, the user only sees a generic message, not which conditions were tried and why each failed.

**Verdict**: ✅ CONFIRMED

**Evidence** (`engine.ts` lines 326–339):

```ts
for (const act of state.actions) {
    const res = await runCondition(act.condition, tapePath, [], cwd, runtime.flow_dir);
    if (res.ok) {
        matched = act;
        matchedReason = res.reason;
        break;
    }
    // res.reason on failure is never captured
}

if (!matched) {
    return { ok: false, error: `epsilon state '${state.state_id}' had no matching condition (and no { default: true })` };
}
```

`runCondition` returns `{ ok, reason }` in both success and failure cases. On failure (`!res.ok`), `res.reason` contains the specific rejection reason for that condition. The loop discards it — there is no accumulator for failed reasons. The final error message at line 339 names only the state, not the conditions tried or why each was rejected.

Contrast: the non-epsilon path in `executeAction` also calls `runCondition`, and the caller at line 190 surfaces `entry.reasons` — but `chainEpsilon` never builds such a list. A user debugging a stuck epsilon chain has no visibility into which conditions were evaluated or what each returned.

---

## D3-006 — `popFsm` swallows `fs.rm` errors, orphan FSM directory persists

**Claim**: `storage.ts` `popFsm` (lines 118–120) catches and swallows `fs.rm` errors. The stack has already been committed, so if `rm` fails the orphan FSM directory persists with no cleanup path.

**Verdict**: ✅ CONFIRMED — with qualification on severity

**Evidence** (`storage.ts` lines 111–124):

```ts
export async function popFsm(sessionDir: string): Promise<string | undefined> {
    const stack = await readStack(sessionDir);
    const top = stack.pop();
    await writeStack(sessionDir, stack);   // line 114 — stack committed here
    if (top) {
        try {
            await fs.rm(fsmDir(sessionDir, top), { recursive: true, force: true });
        } catch {
            // Leave orphan on rm error; not fatal   // line 120
        }
    }
    return top;
}
```

The sequence is:
1. `writeStack` at line 114 commits the new (shorter) stack to disk — point of no return.
2. `fs.rm` at line 118 attempts to remove the FSM directory.
3. If `fs.rm` throws despite `{ force: true }` (e.g., locked file on some platforms, or a race), the catch block at line 120 silently swallows it.

Result: `stack.json` no longer references the FSM, but its directory (`sessionDir/<fsmId>/`) remains on disk. There is no subsequent cleanup path — `sweepOrphans` (lines ~140+) targets `.tmp.*` files only, not orphaned FSM directories. The orphan accumulates silently.

**Qualification**: The comment "not fatal" is intentional — the author is aware this is best-effort. The finding is valid as a data-integrity concern (disk bloat, potential stale-state confusion on manual inspection), but severity is lower than D3-001/D3-002 since the orphan cannot be accidentally reloaded (it is no longer on the stack).

---

## Summary

| Finding | Verdict | Confidence |
|---------|---------|------------|
| D3-001 | ✅ Confirmed | High — bare `await persistRuntime` at line 244, no guard |
| D3-002 | ✅ Confirmed | High — bare `await popFsm` at lines 180 and 190 in catch/failure paths |
| D3-004 | ✅ Confirmed | High — failure reasons from `runCondition` never accumulated in `chainEpsilon` |
| D3-006 | ✅ Confirmed (lower severity) | High — intentional best-effort, but orphan has no cleanup path |

All four findings independently verified from source. No audit docs consulted.
