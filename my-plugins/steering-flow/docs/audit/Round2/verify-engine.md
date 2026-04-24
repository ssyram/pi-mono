# engine.ts Fix Verification — Round 2

**Date**: 2026-04-23  
**Files reviewed**: `engine.ts`, `storage.ts`  
**Method**: Source inspection via `read` + targeted `grep` (line-precise)

---

## NDA-08 — Tape rollback on epsilon chain failure

**Verdict: ✅ PASS**

### Evidence

#### `executeAction` (lines 247–291)

| Line | Code | Role |
|------|------|------|
| 247 | `const tapeSnapshot = await readFile(tapePath, "utf-8");` | Snapshot taken before any condition runs |
| 249 | `await runCondition(action.condition, ...)` | Condition (may mutate tape) runs AFTER snapshot |
| 290 | `runtime.current_state_id = snapshotStateId;` | State rolled back on epsilon chain failure |
| 291 | `await writeFile(tapePath, tapeSnapshot, "utf-8");` | Tape rolled back to pre-condition content |

**Ordering**: Snapshot at L247 strictly precedes `runCondition` at L249 — no race condition is possible in the single-threaded async execution model.

#### `chainEpsilon` (lines 326–371)

| Line | Code | Role |
|------|------|------|
| 326 | `const epsilonTapeSnapshot = await readFile(tapePath, "utf-8");` | Snapshot at function entry, before `while` loop |
| 332–333 | `writeFile(tapePath, epsilonTapeSnapshot)` + return error | Restored on: state-not-found |
| 354 | `writeFile(tapePath, epsilonTapeSnapshot)` + return error | Restored on: no matching condition |
| 371 | `writeFile(tapePath, epsilonTapeSnapshot)` + return error | Restored on: depth-limit exceeded |
| 366/369 | `return { ok: true, ... }` (no writeFile) | Success path — mutations preserved correctly |

**All three failure branches** restore the tape before returning. The success path does not call `writeFile`, preserving legitimate mutations.

### Snapshot Fidelity

`readFile(..., "utf-8")` reads the actual file bytes as a string — this is a deep copy of the on-disk content, not an in-memory reference. `writeFile` restores exactly those bytes. No aliasing risk.

> **Note (non-blocking)**: The snapshot uses raw `readFile`/`writeFile` rather than `storage.ts`'s `readTape`/`writeTape` (which uses `atomicWriteJson` / tmp+rename). For rollback purposes this is functionally correct — the string round-trip is lossless and the rollback call is not concurrent with other writes. Consistency with storage conventions would be a minor improvement but is not a regression.

### Regression Check

- Success paths in both `executeAction` and `chainEpsilon` are structurally unchanged.
- `readFile` is added only as a pre-condition read; it does not alter control flow on the success path.
- `writeFile` calls are guarded exclusively to failure branches.

---

## NDA-04 — epsilon `namedArgs` missing (`{}` not passed to `runCondition`)

**Verdict: ✅ PASS**

### Evidence

**Line 344** in `chainEpsilon`'s for-loop:
```ts
const res = await runCondition(act.condition, tapePath, [], cwd, runtime.flow_dir, {});
// NDA-04: pass explicit empty namedArgs (epsilon states have no declared args)
```

- Sixth argument `{}` is explicitly passed.
- Comment confirms intent.
- Prior call was missing this argument entirely, leaving `namedArgs` as `undefined` inside `runCondition`, which caused interpolation failures on epsilon transitions.

### Regression Check

- The `{}` literal is a safe default — callers that relied on the implicit `undefined` behaviour were broken by definition (this was the bug). Passing `{}` restores contract-correct behaviour.
- Non-epsilon calls to `runCondition` (in `executeAction`) are unaffected — they pass caller-provided `namedArgs` unchanged.

---

## NDA-07 — `chainEpsilon` rejection reasons not propagated

**Verdict: ✅ PASS**

### Evidence

In `chainEpsilon`'s condition-evaluation loop:

```ts
const failReasons: string[] = [];          // collected before loop

// per-iteration, on condition failure:
failReasons.push(`action '${act.action_id}': ${res.reason}`);

// on no-match exit:
const detail = failReasons.length > 0
  ? `; tried: ${failReasons.join(" | ")}`
  : "";
// error string:
`epsilon state '${state.state_id}' had no matching condition (and no { default: true })${detail}`
```

- `failReasons` is declared before the condition loop.
- Every failed condition pushes `action_id` + `res.reason` — per-condition granularity.
- On the "no matching condition" exit, all reasons are joined with ` | ` and appended to the final error.
- If no conditions ran (edge case: empty action list), `detail` is `""` — graceful fallback.

### Regression Check

- `failReasons` accumulation only occurs on `!res.ok` branches.
- Successful conditions (`res.ok === true`) set `matched` and break the loop normally — no impact on success path.
- The `detail` suffix is appended only to the error string returned on failure — not present in any success return value.

---

## Summary

| Finding | Description | Verdict |
|---------|-------------|---------|
| NDA-08 | Tape snapshot before `runCondition`; restore on all failure branches in `executeAction` and `chainEpsilon` | ✅ PASS |
| NDA-04 | `{}` passed as `namedArgs` to `runCondition` inside epsilon chain loop | ✅ PASS |
| NDA-07 | Per-condition failure reasons collected and appended to final error message | ✅ PASS |

**All three fixes are correctly implemented with no detected regressions.**
