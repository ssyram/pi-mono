# Round 10 Convergence Audit

**Date**: 2026-04-24  
**Files audited**: `index.ts`, `storage.ts`, `visualizer/render-html.ts`, `visualizer/drag-nodes.ts`  
**Scope**: Verify Round 9 fixes; holistic scan for any remaining issues not caught in Rounds 2–9.

---

## R9 Fix Verification

### R9-001 — `session_start` recovery catch calls `deletePendingPop`

**Status: CONVERGED ✅**

`const dir = getSessionDir(ctx.sessionManager.getCwd(), sid)` is declared at line 797, inside the `withSessionLock` async callback body, **before** the inner `try` block. The inner catch at line 829–830 reads:

```ts
console.error('[steering-flow] session_start recovery error:', e);
await deletePendingPop(dir).catch(() => {});
```

`dir` is unambiguously in scope. `.catch(() => {})` correctly swallows any error from `deletePendingPop` itself; the inner catch does not rethrow, so the outer `withSessionLock` catch at line 833–834 only fires for lock-acquisition failures, not recovery failures. No new failure mode is introduced.

One observation (not a bug): the outer catch omits a `deletePendingPop` call. This is appropriate — the outer catch fires when `withSessionLock` itself throws before the async body begins executing, so `dir` is never computed and no pending-pop file could exist yet.

---

### R9-V-001 — `resetBtn` and drag-end handlers guard `nodePos` lookups

**Status: PARTIALLY CONVERGED — one new finding (R10-V-001)**

Within `render-html.ts`:

- `resetBtn` node-transform path: `if (!p || !_nodePos[s.id]) return d3.select(this).attr('transform')` ✅  
- `resetBtn` `.on('end', ...)` edge path: `var src = _nodePos[d.src], tgt = _nodePos[d.tgt]; if (!src || !tgt) return;` ✅  
- All other `nodePos[...]` accesses in `renderFsm`: guarded with `if (!n)` / `if (!src || !tgt) return null` ✅  

**Drag-end handler** — `render-html.ts` delegates drag logic to the `dragNodesCode` template string defined in `visualizer/drag-nodes.ts`. The `.on('end', ...)` handler there is:

```js
.on('end', function() { svg.style('cursor','grab'); });
```

No `nodePos` access in drag-end — cursor reset only. ✅ No null guard needed.

However, the `.on('drag', ...)` handler accesses `nodePos[d.id]` at:

```js
var np = nodePos[d.id];
np.x = evt.x;
np.y = evt.y;
```

`np` is not null-checked before being written. If `nodePos[d.id]` is `undefined` (which should not happen because drag is only enabled on rendered nodes, but is a defensive gap), this is an immediate TypeError crash. This was **not** flagged in Rounds 2–9.

Additionally, `nodePos[ed.src]` and `nodePos[ed.tgt]` are read without null checks:

```js
var sn = nodePos[ed.src], tn = nodePos[ed.tgt];
ed.srcNode.x = sn.x; ed.srcNode.y = sn.y;
ed.tgtNode.x = tn.x; ed.tgtNode.y = tn.y;
```

If `sn` or `tn` is `undefined`, this crashes. In practice both nodes are in `nodePos` at render time, but this is unguarded unlike the analogous code in `render-html.ts`.

**New finding:** See **R10-V-001** below.

---

### R9-SP-001 — `readPendingPop` rejects empty-string `fsmId`

**Status: CONVERGED ✅**

Check is `!parsed || typeof fsmId !== "string" || fsmId.length === 0` → throws `CorruptedStateError`. Empty string is correctly rejected. Any non-empty string (valid fsmId format) passes. No regression on valid input.

---

### R9-SP-002 — `readState` defaults `last_transition_chain` to `[]`

**Status: CONVERGED ✅**

Logic:
- If `obj.last_transition_chain !== undefined && !Array.isArray(...)` → `CorruptedStateError` ✅  
- If `obj.last_transition_chain === undefined` → `(obj as Record<string, unknown>).last_transition_chain = []` ✅  

The mutation is on `obj`, which is the same reference as `data` (cast from `readJsonStrict`). The return value `data as StateFile` therefore carries the defaulted field. Since `StateFile` declares `last_transition_chain: TransitionRecord[]` as non-optional, no caller can legitimately expect `undefined`, so no caller is broken by this default.

---

### R9-SP-003 — `readFsmStructure` rejects empty states and empty `state_id`

**Status: CONVERGED ✅**

- `Object.keys(data.states).length === 0` → `CorruptedStateError` — empty states map correctly rejected.  
- Per-state loop: `typeof sid !== "string" || sid.length === 0` → `CorruptedStateError` — empty string state IDs correctly rejected.  
- Single-state FSM: passes cleanly — `Object.keys` length is 1 (≠ 0), and any valid non-empty state_id passes the per-state check.  
- No regression on valid structures.

---

## Holistic Scan — New Findings

### R10-V-001 — `drag-nodes.ts`: unguarded `nodePos` accesses in `.on('drag', ...)`

**File**: `visualizer/drag-nodes.ts`  
**Severity**: Low (crash-path; practically unreachable under normal render flow, but undefended)  
**Lines**: drag handler body

```js
var np = nodePos[d.id];      // np may be undefined if d.id not in nodePos
np.x = evt.x;                // TypeError if np is undefined
np.y = evt.y;

// ...later in edgeGroups.each:
var sn = nodePos[ed.src], tn = nodePos[ed.tgt];
ed.srcNode.x = sn.x;        // TypeError if sn is undefined
ed.tgtNode.x = tn.x;        // TypeError if tn is undefined
```

The equivalent code in `render-html.ts` (resetBtn and renderFsm paths) was guarded as part of R9-V-001, but `drag-nodes.ts` was not reviewed in that round. The fix pattern is consistent with what was done in R9:

```js
// np guard
var np = nodePos[d.id];
if (!np) return;
np.x = evt.x; np.y = evt.y; /* ... */

// sn/tn guard
var sn = nodePos[ed.src], tn = nodePos[ed.tgt];
if (!sn || !tn) return;
```

---

### R10-V-002 — `resetBtn` `.on('end', ...)`: edge layout not fully reset when `layoutEdge` lookup fails

**File**: `visualizer/render-html.ts`  
**Severity**: Low (visual glitch; no crash)

In the resetBtn `.on('end', ...)` callback, the code finds the matching layout edge by label key. If the lookup fails (returns `null`/`undefined`), the guard `if (!src || !tgt) return` exits early — but `d.points`, `d.labelX`, and `d.labelY` are **not** reset to their original layout values. The edge polyline remains at its dragged position after reset. The node visually snaps back but the connecting edge label/path does not.

This was observed during holistic review of render-html.ts; it is not a regression from R9.

**Suggested fix**: before the early return, reset `d.points`, `d.labelX`, `d.labelY` from `_layoutEdge` (original layout snapshot) if available, or accept the limitation and document it.

---

### R10-INDEX-001 — `session_start` outer catch omits `deletePendingPop` (documentation note only)

**Severity**: Info (not a bug)

As noted in R9-001 verification above: the outer catch (lock-acquisition failure) correctly omits `deletePendingPop`. `dir` is technically in scope (closure over the outer function), but no pending-pop file was written before the lock was acquired, so calling `deletePendingPop` would be a spurious no-op at best. **No action required.**

---

## Summary

| ID | Description | Status |
|----|-------------|--------|
| R9-001 | `session_start` catch has `dir` in scope; `.catch(() => {})` correct | ✅ CONVERGED |
| R9-V-001 | `resetBtn` / drag-end `nodePos` null guards in `render-html.ts` | ✅ CONVERGED |
| R9-SP-001 | `readPendingPop` rejects empty-string `fsmId` | ✅ CONVERGED |
| R9-SP-002 | `readState` defaults `last_transition_chain` to `[]` | ✅ CONVERGED |
| R9-SP-003 | `readFsmStructure` rejects empty states and empty `state_id` | ✅ CONVERGED |
| **R10-V-001** | `drag-nodes.ts` `.on('drag')`: `np`, `sn`, `tn` from `nodePos` unguarded | 🔴 NEW |
| **R10-V-002** | `resetBtn` `.on('end')`: edge `points`/`labelX`/`labelY` not reset on failed `layoutEdge` lookup | 🟡 NEW |
| R10-INDEX-001 | Outer `session_start` catch omits `deletePendingPop` — intentional and correct | ℹ️ INFO |

**NOT FULLY CONVERGED.** Two new findings (R10-V-001, R10-V-002) require a Round 11 fix pass. All Round 9 fixes verified correct.
