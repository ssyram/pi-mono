# Round 2 Verification: NDA-05, NDA-06, NDA-09

**Date:** 2026-04-23  
**Files reviewed:** `index.ts`, `storage.ts`  
**Method:** Full file read + grep confirmation

---

## NDA-05 — `persistRuntime` try/catch in `actionCall`

**Verdict: ✅ PASS**

### Evidence

In `actionCall`, inside the `if (result.success)` branch:

```ts
try {
  await persistRuntime(...)
} catch (persistErr) {
  console.error(...)
  return `✅ Action succeeded but state persistence failed: ${persistErr...}`
}
```

### Checklist

- [x] `persistRuntime` call is inside a `try` block
- [x] `catch` clause captures the error (`persistErr`)
- [x] Descriptive message returned — includes `persistErr.message`, distinguishes action success from persist failure
- [x] Error is **not silently swallowed** — both logged and surfaced to caller
- [x] No regression: action success path and failure path remain separate; catch does not mask `result.success`

---

## NDA-06 — `popFsm` rollback wrapping in `loadAndPush`

**Verdict: ✅ PASS**

### Evidence — Site 1 (`enterStart` catch block)

```ts
// catch block after enterStart
try {
  await popFsm(...)
} catch (rollbackErr) {
  console.error(rollbackErr)
  throw e   // original error re-thrown
}
throw e     // original error re-thrown even if rollback succeeded
```

### Evidence — Site 2 (after `!entry.success` check)

```ts
try {
  await popFsm(...)
} catch (rollbackErr) {
  console.error(rollbackErr)
}
return { /* original failure info from entry.reasons */ }
```

### Checklist

- [x] **Both** `popFsm` call sites in `loadAndPush` are wrapped in try/catch
- [x] Site 1: original error `e` is re-thrown regardless of rollback outcome — original error preserved
- [x] Site 2: return value carries `entry.reasons` from the original failure — original error preserved
- [x] Rollback failure is logged (`rollbackErr`) but does not replace or discard the original error
- [x] No regression: normal (success) path unchanged; rollback wrapping is confined to the existing catch/failure paths

---

## NDA-09 — `flow_dir` fallback in `loadRuntime` (storage.ts)

**Verdict: ✅ PASS**

### Evidence

```ts
// in loadRuntime struct destructuring / reconstruction:
flow_dir: struct.flow_dir ?? fsmDir(sessionDir, fsmId),
// backward-compat: migrated sessions lack flow_dir; fall back to FSM storage dir rather than CWD
```

`fsmDir(sessionDir, fsmId)` resolves to `join(sessionDir, fsmId)` — a concrete, session-scoped path.

### Checklist

- [x] `??` (nullish coalescing) used — catches both `undefined` and `null`
- [x] Fallback is `fsmDir(sessionDir, fsmId)`, a deterministic path derived from live session context
- [x] Fallback is **not** `""` (empty string), not `process.cwd()`, not any ambient global
- [x] Code comment confirms intent: backward-compat for migrated sessions
- [x] No regression: sessions that already have `flow_dir` set use it unchanged; only missing-field sessions fall back

---

## Summary

| Fix    | Location                          | Verdict |
|--------|-----------------------------------|---------|
| NDA-05 | `actionCall` → `persistRuntime`   | ✅ PASS |
| NDA-06 | `loadAndPush` → `popFsm` (×2)    | ✅ PASS |
| NDA-09 | `loadRuntime` → `flow_dir` field  | ✅ PASS |

All three fixes are correctly implemented with no observed regressions.
