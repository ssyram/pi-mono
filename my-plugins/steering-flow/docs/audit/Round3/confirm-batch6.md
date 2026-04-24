# Audit Round 3 — Batch 6 Confirmation

**Reviewer**: Fresh independent pass (no prior audit docs read)  
**Date**: 2026-04-24  
**Source**: `/my-plugins/steering-flow/` — read-only, no modifications

---

## D2-006 (GUARDED) — Date objects in tape → stableStringify non-determinism

**Verdict: REJECTED**

Tape values flow through a strict JSON round-trip at every boundary:

- `writeTape` → `atomicWriteJson` → `JSON.stringify`
- `readTape` → `readJsonStrict` → `JSON.parse`

`JSON.stringify` serializes `Date` as an ISO string (primitive), and `JSON.parse` produces a plain string — never a `Date` object. There is no code path in `loadAndPush`, `actionCall`, `saveCall`, or the Stop hook that inserts a `Date` instance into `rt.tape` directly. The tape type is `Record<string, TapeValue>` and all writes go through `saveCall` which validates against `MAX_TAPE_VALUE_BYTES` before calling `writeTape`.

`stableStringify` does have a latent quirk with `Date` objects (falls into the object branch, `Object.keys(date)` = `[]`, returns `"{}"`), but this is unreachable because tape can never contain a `Date` instance.

**Finding is a false positive. No action needed.**

---

## D2-007 (GUARDED) — Circular references in tape → stableStringify infinite loop

**Verdict: REJECTED**

Same structural argument as D2-006. Tape is always the product of `JSON.parse`. The JSON specification prohibits circular references — a circular object cannot be encoded into JSON, and `JSON.parse` cannot produce one. There is no in-memory mutation path that introduces circulars into `rt.tape` after deserialization; all tape writes go through `writeTape` (serialise → file → deserialise).

`stableStringify` has no cycle guard, so a circular input *would* infinite-loop. But the input invariant (tape = JSON-parsed value) makes this unreachable.

**Finding is a false positive. No action needed.**

---

## D2-011 (GUARDED) — `signal?.aborted` when signal is undefined

**Verdict: CONFIRMED SAFE**

Location: `index.ts` line 663.

```ts
if (ctx.signal?.aborted) return;
```

When `ctx.signal` is `undefined`, the optional chain short-circuits to `undefined`, which is falsy. The `if` body is not entered, execution continues normally — which is the correct behavior (no signal = not aborted). This is idiomatic TypeScript optional chaining and behaves exactly as intended.

**No bug. Finding can be closed.**

---

## D3-006 (GUARDED) — O(80·n²) repulsion in label-layout.ts

**Verdict: LOW RISK (not a current concern)**

Confirmed algorithm in `forceAvoid` (`label-layout.ts`):

```
for iter in 0..80:
  for i in 0..labels.length:
    for j in i+1..labels.length:
      // repulsion
```

This is O(80 · n²) where **n = number of FSM edges** (one label per edge), not per state.

Realistic FSM sizes in steering-flow: the plugin is designed for conversational steering flows, not general-purpose state machines. `layoutFsm` receives states from the visualizer, each with `actions[]`. A typical steering FSM has 5–20 states and 10–50 transitions.

At n=50: 80 × 50² = 200,000 iterations — negligible, <1 ms.  
At n=200: 80 × 200² = 3,200,000 iterations — ~10–30 ms.  
At n=500: 80 × 500² = 20,000,000 — ~100–300 ms.

There is no cap on FSM size. However, reaching 200+ transitions would be an unusual authoring pattern for this domain. The algorithm runs only in the visualizer (artifact rendering), not in the hot path.

**Real algorithmic complexity, not a practical concern at realistic FSM sizes. Worth a code comment noting the O(n²) nature. Not a blocking issue.**

---

## D4-002 (GUARDED) — withSessionLock deadlock on same-key re-entry

**Verdict: LATENT RISK — not triggered by current code**

`withSessionLock` in `storage.ts` is a promise-chain mutex. Re-entrant acquisition of the same key deadlocks:

```
tail = fn()                         // fn holds the lock
inner = withSessionLock(key, ...)   // inner.prev = tail
// inner waits for tail; tail waits for inner → deadlock
```

**Current code audit**: Every `withSessionLock(sessionId, callback)` call site passes one of: `loadAndPush`, `actionCall`, `saveCall`, `infoCall`, `popCall`, or the Stop hook's inline async function. All were traced in full (lines 118–357 + 677–720). None call `withSessionLock` internally — they only call storage-layer primitives (`readTape`, `writeTape`, `readStack`, `writeState`, etc.) which are lock-free.

**Conclusion**: No current call path triggers the deadlock. The risk is real if a future contributor adds a `withSessionLock` call inside a locked callback without knowing the mutex is non-reentrant.

**Recommendation**: Add a JSDoc warning to `withSessionLock` that it is non-reentrant. Keep open as a documentation/safety gap, not a live bug.

---

## D4-003 (GUARDED) — Cross-process lock not supported

**Verdict: CONFIRMED INTENTIONAL LIMITATION**

`sessionLocks` is declared as:

```ts
const sessionLocks = new Map<string, Promise<unknown>>();
```

Module-level in-memory Map — no inter-process coordination. Two Node.js processes on the same `sessionId` would each have their own map and could race on the same files. There is no file-based lock (`lockfile`, `flock`, `.lock` sentinel). `atomicWriteJson` uses tmp-file + rename (atomic for single writes) but does not prevent concurrent read-modify-write races across processes.

Consistent with the deployment model: steering-flow is a single-process pi plugin. Cross-process access is not a supported use case.

**Confirmed intentional. No action needed unless multi-process support is ever added.**

---

## Summary Table

| ID | Original | Confirmed | Action |
|---|---|---|---|
| D2-006 | GUARDED | **REJECTED** | Close — tape is always JSON-parsed, Date objects structurally impossible |
| D2-007 | GUARDED | **REJECTED** | Close — JSON cannot encode circulars, structurally impossible |
| D2-011 | GUARDED | **SAFE** | Close — optional chain on undefined is correct and intentional |
| D3-006 | GUARDED | **LOW RISK** | Keep open — add O(n²) comment; not a practical concern at current FSM sizes |
| D4-002 | GUARDED | **LATENT RISK** | Keep open — no live bug; add non-reentrant warning to `withSessionLock` JSDoc |
| D4-003 | GUARDED | **INTENTIONAL** | Close — single-process design, limitation is by design |
