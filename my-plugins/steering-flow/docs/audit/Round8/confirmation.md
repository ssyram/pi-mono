# Round 8 Audit — Independent Confirmation Report

**Reviewer**: Sisyphus-Junior (fresh reviewer, no access to prior audit docs)  
**Date**: 2026-04-24  
**Sources verified**: `index.ts`, `engine.ts`, `storage.ts`, `visualizer/render-html.ts`, `visualizer/label-layout.ts`, `visualizer/document.ts`  
**Method**: Direct source reading only; no prior audit docs consulted.

---

## Summary Table

| Finding | Verdict | Short Reason |
|---|---|---|
| R8-I-001 | **CONFIRMED-AND-FIXED** | fsmId match guard present before pop |
| R8-I-002 | **CONFIRMED-AND-FIXED** | abort checked both before and inside withSessionLock |
| R8-I-004 | **CONFIRMED-AND-FIXED** | try/catch around pushFsm removes fsmId dir on failure |
| R8-E-001 | **CONFIRMED-AND-FIXED** | transition_log pushed in all committed executeAction paths |
| R8-E-002 | **CONFIRMED-AND-FIXED** | rollback returns before log push; only committed chains logged |
| R8-E-003 | **CONFIRMED-AND-FIXED** | `closed = true` set before `settle()` in both error and close handlers |
| R8-V-001 | **CONFIRMED (NOT FIXED)** | `$START` hardcoded in `buildFileVisualizerDocument` |
| R8-V-002 | **CONFIRMED-AND-FIXED** | nodePos accesses guarded at all call sites in render-html.ts |
| R8-V-003 | **CONFIRMED-AND-FIXED** | `d.edge.action` guarded before every access in render-html.ts |
| R8-V-004 | **CONFIRMED-AND-FIXED** | Dangling transitions warned and skipped in label-layout.ts |
| R8-SP-002 | **CONFIRMED-AND-FIXED** | readPendingPop validates `fsmId` as string at runtime |
| R8-SP-003 | **CONFIRMED-AND-FIXED** | readState validates `last_transition_chain` is an array if present |
| R8-SP-004 | **CONFIRMED-AND-FIXED** | readFsmStructure validates each State entry has a valid `state_id` |

---

## Detailed Verdicts

### R8-I-001 — session_start: fsmId match before pop

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`index.ts`, `session_start` handler):  
Before calling `popFsm`, the code reads the current stack as `stackForPop` and explicitly checks:

```ts
if (stackForPop[stackForPop.length - 1] !== pendingPop.fsmId) {
    // mismatch: log warning, delete marker, skip pop
}
```

If the stack top does not equal `pendingPop.fsmId`, the code logs a warning and deletes the pending-pop marker without performing the pop. The `popFsm` call only executes when the match succeeds. The original risk (popping the wrong FSM) is fully addressed.

---

### R8-I-002 — agent_end: abort check inside withSessionLock

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`index.ts`, `agent_end` handler, lines 703 and 713):  

```ts
// Before acquiring lock:
if (ctx.signal?.aborted) return;
if (wasAborted(event.messages)) return;

// First line inside the lock lambda:
await withSessionLock(sessionId, async () => {
    if (ctx.signal?.aborted) return;   // <-- inside lock
    ...
});
```

Double-guard pattern: abort is checked before acquiring the lock (avoiding unnecessary lock contention) and again as the very first statement inside the lock lambda (covering abort that raced the lock acquisition). Both checks use `ctx.signal?.aborted`.

---

### R8-I-004 — pushFsm failure: cleanup of partial writes

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`index.ts`, `loadAndPush`, lines ~155–162):

```ts
await writeFsmStructure(sessionDir, fsmId, ...);
await writeState(sessionDir, fsmId, "$START", []);
await writeTape(sessionDir, fsmId, {});
try {
    await pushFsm(sessionDir, fsmId);
} catch (e) {
    await fs.rm(`${sessionDir}/${fsmId}`, { recursive: true, force: true }).catch(() => {});
    throw e;
}
```

If `pushFsm` throws, the catch block removes the entire `fsmId` subdirectory (which contains the files written by the three preceding `write*` calls), then rethrows. This prevents orphaned FSM data on the filesystem. Note: failures in the three `write*` calls before `pushFsm` are not individually rolled back; however, that is outside the scope of R8-I-004, which specifically concerned `pushFsm` failure.

---

### R8-E-001 — transition_log is written

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`engine.ts`, `executeAction`):  
Both terminal paths that represent a committed transition push to `runtime.transition_log`:

1. **`$END` branch**: After entering the end state, `runtime.transition_log ??= []; runtime.transition_log.push(...chain)`.
2. **Normal settled branch**: After `settle()` completes, same push pattern.

The `enterStart` path does not push (correct — no transition occurs at start). The log is then passed to `writeState` when the runtime is persisted.

---

### R8-E-002 — Only committed transitions are logged

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`engine.ts`, `executeAction`):  
The rollback path (condition check failed or epsilon chain failed) restores `runtime.current_state_id = snapshotStateId` and returns early — **before** reaching the `transition_log.push(...)` statement. Therefore, rolled-back chains never appear in the transition log. Only the code path that completes `settle()` successfully reaches the log push.

---

### R8-E-003 — closed=true before settle() in runCondition error handler

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`engine.ts`, `runCondition`):  
Both relevant event handlers follow the required ordering:

- `child.on("error", (err) => { closed = true; settle(err); })` — `closed` is set first.
- `child.on("close", (code, signal) => { closed = true; ...; settle(...); })` — `closed` is set at the top of the handler before `settle()` is called at the bottom.

This ensures that any re-entrant call triggered by `settle()` sees `closed === true` and does not double-invoke the settlement logic.

---

### R8-V-001 — $START hardcoded in file mode visualizer

**Verdict: CONFIRMED (NOT FIXED)**

**Evidence** (`visualizer/document.ts`, `buildFileVisualizerDocument`):

```ts
currentStateId: "$START",
```

This is a literal string constant with no lookup against the FSM definition. If a file-mode FSM uses a different initial state name, the visualizer will display an incorrect highlight. No fix is present in the current code.

**Note**: For the session mode path (`buildSessionVisualizerDocument`), `currentStateId` is correctly taken from the loaded runtime (`rt.current_state_id`). The problem is isolated to file mode only.

---

### R8-V-002 — nodePos accesses guarded in render-html.ts

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`visualizer/render-html.ts`):

- Edge path calculation: `if (!src || !tgt) return null;` guard before any `nodePos` coordinate access on the edge source/target.
- Node transform calculation: `if (!n) return 'translate(0,0)';` guard on node position lookup.

All `nodePos` map accesses that produce coordinates used in SVG attribute computation are preceded by null-coalescing or explicit null checks. No bare unguarded `nodePos[id]` dereferences exist in rendering paths.

---

### R8-V-003 — d.edge.action accesses guarded in render-html.ts

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`visualizer/render-html.ts`):

- Tooltip `mouseover` handler: `if (!d.edge.action) { hideTooltip(); return; }` — returns before accessing action fields.
- Click handler: `if (!d.edge.action) return;` — returns before accessing action fields.

Both interaction handlers guard `d.edge.action` before dereferencing any of its properties. Upstream, `label-layout.ts` skips adding dangling transitions to the graph (they have no valid action), so all edges in the rendered graph should have a valid action, but the runtime guards provide defense-in-depth.

---

### R8-V-004 — Dangling transitions warned in label-layout.ts

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`visualizer/label-layout.ts`):  
In the edge-building loop, before calling `g.setEdge(...)`:

```ts
if (!stateIds.has(a.nextStateId)) {
    warnings.push(`Dangling transition: ${s.id} -> ${a.nextStateId} (state not found)`);
    continue;  // skips g.setEdge — edge never added to graph
}
```

Dangling transitions (where `nextStateId` is not a known state) are both warned about (pushed to the returned `warnings` array in `LayoutResult`) and excluded from the graph. The caller can surface these warnings to the user.

---

### R8-SP-002 — readPendingPop validates parsed JSON shape

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`storage.ts`, `readPendingPop`):

```ts
const parsed = await readJsonStrict<unknown>(path);
if (!parsed || typeof (parsed as Record<string, unknown>).fsmId !== 'string') {
    throw new CorruptedStateError('invalid shape: missing fsmId');
}
```

The function reads with `unknown` type then validates `fsmId` is a string before returning. A missing or non-string `fsmId` results in a `CorruptedStateError` rather than a silent type mismatch. Note: the `timestamp` field is not validated, but `fsmId` (the operationally critical field used to match against the stack) is.

---

### R8-SP-003 — readState validates last_transition_chain

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`storage.ts`, `readState`):

```ts
if (obj.last_transition_chain !== undefined && !Array.isArray(obj.last_transition_chain)) {
    throw new CorruptedStateError('invalid shape: last_transition_chain must be an array');
}
```

The field is validated to be an array if present. Individual chain element shapes (transition records) are not validated, but the outer container type is protected. An unexpected non-array value (e.g., a stringified chain from a schema mismatch) will throw rather than be silently coerced.

---

### R8-SP-004 — readFsmStructure validates State entries

**Verdict: CONFIRMED-AND-FIXED**

**Evidence** (`storage.ts`, `readFsmStructure`):

```ts
for (const [key, state] of Object.entries(data.states)) {
    if (typeof state.state_id !== 'string') {
        throw new CorruptedStateError(`state at key "${key}" is missing a valid state_id`);
    }
}
```

After validating the top-level `states` object exists, the function iterates every entry and validates that each has a `state_id` string. An entry that is null, missing, or has a non-string `state_id` throws a `CorruptedStateError` naming the offending key. This ensures each state in the loaded structure has at minimum a valid identity string.

---

## Notes for Round 9

- **R8-V-001** remains unfixed. The file-mode visualizer hardcodes `$START` as the initial state. A future fix should read the FSM definition's actual initial state (e.g., the first key in `states`, or a `start_state_id` field if one is added to the format).
- **R8-SP-002/003/004**: All three now have minimal shape validation. Deeper per-element validation of `last_transition_chain` contents and per-action validation within State entries are still absent, but those are new findings not carried from Round 8.
