# Round 11 Convergence Audit

**Scope**: Convergence check on Round 10 fixes only.  
**Files inspected**: `visualizer/drag-nodes.ts`, `visualizer/render-html.ts`  
**Date**: 2026-04-24

---

## R10-V-001 — `nodePos` null guards in `drag-nodes.ts`

**Status: ✅ CONVERGED**

### Verification

Every `nodePos` access site in `drag-nodes.ts` is guarded:

| Site | Code | Guard |
|------|------|-------|
| `drag` handler — current node position | `var np = nodePos[d.id]; if (!np) return;` | ✅ early return |
| `edgeGroups.each` — src/tgt positions | `var sn = nodePos[ed.src], tn = nodePos[ed.tgt]; if (!sn \|\| !tn) return;` | ✅ early return |

Guard pattern is correct: both use `return` (appropriate inside `.on('drag', ...)` and `.each(...)` respectively). No other `nodePos` accesses exist anywhere in the file. No unguarded access sites remain.

---

## R10-V-002 — `resetBtn` `end` callback: data reset ordering

**Status: ✅ CONVERGED (with one non-blocking observation)**

### Verification — execution order (lines 590–621)

```
1. LAYOUTS[...].edges.find(...)          → layoutEdge lookup
2. if (layoutEdge) { d.points = ...; d.labelX = ...; d.labelY = ...; }  → conditional reset
3. var src = _nodePos[d.src], tgt = _nodePos[d.tgt];
   if (!src || !tgt) return;             → src/tgt guard
4. d.srcNode = ...; d.tgtNode = ...;
5. var pts = d.points.slice(); ...       → uses d.points
6. polylineSplit(pts, d.labelX, d.labelY)
```

The `d.points` / `d.labelX` / `d.labelY` reset occurs **before** the `_nodePos` src/tgt guard, satisfying the R10 requirement. If the guard fires and returns early, the data reset has already happened, so dragged-stale values never persist past a reset animation.

### Observation (non-blocking, pre-existing pattern)

`LAYOUTS[Number(fsmSelect.value) || 0]` on line 595 is unguarded: if `fsmSelect.value` is out of range for the `LAYOUTS` array, `.edges` throws. This is a pre-existing pattern not introduced by R10 and not a null-deref on `nodePos`/edge-data maps. It is recorded here for completeness but does **not** block convergence.

### Residual stale-data note

When `layoutEdge` is not found (no matching edge in the current layout), `d.points` / `d.labelX` / `d.labelY` retain whatever values they held before the reset (possibly drag-modified). The code then proceeds normally using those values if `src` and `tgt` exist. This is a **stale-data fallback**, not a null-deref. The edge will render with its last drag position rather than the canonical layout position. This is a correctness concern, not a crash risk. It was present before R10 and is out of scope for this convergence check.

---

## Holistic Null-Deref Scan — Both Files

### `drag-nodes.ts` — complete

No unguarded accesses to `nodePos`, edge data, or node data anywhere in the file. File is clean.

### `render-html.ts` — all position map access sites

| Site (approx. line) | Variable | Guard |
|---------------------|----------|-------|
| `edgeData` map filter | `nodePos[e.srcId]`, `nodePos[e.tgtId]` | `if (!src \|\| !tgt) return null;` + `.filter(Boolean)` ✅ |
| Node `transform` attr | `nodePos[s.id]` | `if (!n) return 'translate(0,0)'` ✅ |
| `resetBtn` node transition `end` | `_initPos[s.id]`, `_nodePos[s.id]` | `if (!p \|\| !_nodePos[s.id]) return ...` ✅ |
| `resetBtn` edge `end` — src/tgt | `_nodePos[d.src]`, `_nodePos[d.tgt]` | `if (!src \|\| !tgt) return;` ✅ |

All four `nodePos`/`_nodePos`/`_initPos` access sites in `render-html.ts` are guarded. No unguarded accesses found in holistic scan.

---

## Summary

| Finding | Status |
|---------|--------|
| R10-V-001: all `nodePos` accesses guarded in `drag-nodes.ts` | ✅ CONVERGED |
| R10-V-002: data reset before src/tgt guard in `resetBtn` `end` | ✅ CONVERGED |
| Holistic scan — `drag-nodes.ts` | ✅ Clean |
| Holistic scan — `render-html.ts` | ✅ Clean |
| Pre-existing `LAYOUTS[out-of-range]` unguarded array access | ⚠️ Pre-existing, out of scope |
| Stale `d.points` when `layoutEdge` not found | ⚠️ Pre-existing correctness issue, not a crash |

**CONVERGED — no new null-deref findings. All R10 fixes verified correct.**
