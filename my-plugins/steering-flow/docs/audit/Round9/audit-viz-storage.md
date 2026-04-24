# Round 9 Regression Audit — Visualizer + Storage
**Scope**: Round 8 fixes in `visualizer/render-html.ts`, `visualizer/label-layout.ts`, `visualizer/create-artifact.ts`, `storage.ts`
**Date**: 2026-04-24

---

## Summary

| ID | File | Round 8 Fix | Status |
|---|---|---|---|
| R8-V-002 | render-html.ts | nodePos null guards | ⚠️ PARTIAL REGRESSION |
| R8-V-003 | render-html.ts | d.edge.action guards | ✅ CONVERGED |
| R8-V-004 | label-layout.ts / create-artifact.ts | dangling transition warnings | ✅ CONVERGED |
| R8-SP-002 | storage.ts | readPendingPop fsmId validation | ⚠️ GAP |
| R8-SP-003 | storage.ts | readState last_transition_chain validation | ⚠️ GAP |
| R8-SP-004 | storage.ts | readFsmStructure state_id validation | ⚠️ GAP |

---

## Findings

### R9-V-001 — Unguarded `_initPos` / `_nodePos` access in `resetBtn` click handler
**File**: `visualizer/render-html.ts` ~line 584–594
**Severity**: **Medium**

**Description**: The `resetBtn` click handler animates nodes back to their initial positions using:
```js
var p = _initPos[s.id];
_nodePos[s.id].x = p.x;   // line 585 — two issues
_nodePos[s.id].y = p.y;   // line 586
```
and later in the `'end'` callback:
```js
var src = _nodePos[d.src], tgt = _nodePos[d.tgt];
d.srcNode = { x: src.x, y: src.y };   // line 593 — no null check on src/tgt
d.tgtNode = { x: tgt.x, y: tgt.y };
```

**Issues**:
1. `_initPos[s.id]` is looked up with no null check. If `s.id` is not in `_initPos` (e.g., a node added to the D3 selection after `_initPos` was populated), `p` is `undefined` and `p.x` throws a `TypeError`.
2. `_nodePos[s.id]` is dereferenced immediately after — if it is `undefined`, writing `.x = p.x` throws before `p.x` would even be evaluated.
3. In the `'end'` callback `src` / `tgt` are not null-checked before `.x` / `.y` access. If `d.src` or `d.tgt` doesn't exist in `_nodePos`, a `TypeError` crashes the post-animation redraw.

**Contrast**: The same pattern at the `node transform` callback (line ~420 area, normal render path) correctly guards with `if (!n) return 'translate(0,0)'`, and `edgeData` building guards with `if (!src || !tgt) return null`. The `resetBtn` path was not updated consistently.

**Fix direction**: Apply the same guard pattern:
```js
var p = _initPos[s.id];
if (!p || !_nodePos[s.id]) return 'translate(0,0)';
```
and in the `'end'` callback:
```js
if (!src || !tgt) return;
```

---

### R8-V-003 — d.edge.action guards (CONVERGED)
**File**: `visualizer/render-html.ts`
**Severity**: ✅ No regression

Both hover (`mouseenter`) and click handlers on `edgeLabels` guard `d.edge.action` before any access:
- `mouseenter`: `if (!d.edge.action) { hideTooltip(); return; }`
- `click`: `if (!d.edge.action) return;`

No new unguarded sites found.

---

### R8-V-004 — Dangling transition warnings pipeline (CONVERGED)
**Files**: `visualizer/label-layout.ts`, `visualizer/create-artifact.ts`
**Severity**: ✅ No regression

`layoutFsm` in `label-layout.ts`:
- Initializes `const warnings: string[] = []` unconditionally.
- Pushes `"Dangling transition: ${s.id} -> ${a.nextStateId} (state not found)"` for each unresolved target.
- Always returns `{ ..., warnings }` (never `undefined`).

`create-artifact.ts`:
- Both `buildFileVisualizerDocument` and `buildSessionVisualizerDocument` return `{ document, warnings }`.
- `createVisualizerArtifact` collects them and includes `warnings` in the returned `VisualizerArtifactResult`.

Whether warnings are surfaced to the end-user depends on the tool/handler that calls `createVisualizerArtifact` — outside the scope of these 4 files — but the pipeline from detection to result object is intact.

---

### R9-SP-001 — `readPendingPop` accepts empty-string `fsmId`
**File**: `storage.ts` ~line 258–267
**Severity**: **Low**

**Description**: The R8-SP-002 guard is:
```ts
if (typeof parsed.fsmId !== "string") throw ...
```
This correctly rejects non-string values, but an empty string `""` passes the check. An empty `fsmId` would be meaningless and could cause silent downstream failures (wrong FSM looked up, or no-op pop). There is no `parsed.fsmId.length > 0` (or `.trim().length`) check.

**Extra fields**: Extra fields in the parsed JSON are silently ignored — acceptable for forward compatibility, but notable.

**Fix direction**: Add `|| parsed.fsmId.trim() === ""` to the guard condition.

---

### R9-SP-002 — `readState` does not handle missing `last_transition_chain` field
**File**: `storage.ts` ~line 218–237
**Severity**: **Low–Medium**

**Description**: The R8-SP-003 guard is:
```ts
if (obj.last_transition_chain !== undefined && !Array.isArray(obj.last_transition_chain)) throw ...
```
If `last_transition_chain` is entirely **absent** (i.e., `undefined`), the condition short-circuits and validation passes. The data is then cast to `StateFile` which declares `last_transition_chain: TransitionRecord[]` (non-optional). Callers that use the field directly (rather than going through `loadRuntime`, which applies a `?? []` fallback) receive a `StateFile` with `undefined` where an array is expected — a type-unsafe hole.

**`loadRuntime` mitigates** this at that call-site via `state?.last_transition_chain ?? []`, but `readState` is a public function and other callers are not protected.

**Fix direction**: Either (a) make the guard `!Array.isArray(obj.last_transition_chain)` (removing the `!== undefined` short-circuit, treating absence as invalid), or (b) normalise the value inside `readState` itself: `obj.last_transition_chain = obj.last_transition_chain ?? []` before the cast.

---

### R9-SP-003 — `readFsmStructure` allows empty-string `state_id`
**File**: `storage.ts` ~line 181–198
**Severity**: **Low**

**Description**: The R8-SP-004 guard is:
```ts
if (typeof state.state_id !== "string") throw ...
```
An empty string `""` passes this check. An empty `state_id` is semantically invalid and would produce a node with an empty key, which could silently corrupt FSM graph lookups.

Additionally, if `data.states` is an empty object `{}`, the for-loop body never executes — no error is raised, and an FSM with zero states is returned as valid. Whether an empty FSM is a legitimate state or an error depends on domain semantics; if it is always an error, an explicit check (`Object.keys(data.states).length === 0 → throw`) should be added.

**Fix direction**:
- Add `|| state.state_id.trim() === ""` to the state_id guard.
- Optionally add an empty-states guard if domain rules require at least one state.

---

## Unchanged / Out-of-scope

- Edge building `if (!src || !tgt) return null` + `.filter(Boolean)` — correct, unmodified.
- `node transform` guard `if (!n) return 'translate(0,0)'` — correct, unmodified.
- `readFsmStructure` empty `data.states` object — no guard; noted above as a gap (R9-SP-003).
- `resolveOutputPath` path-traversal guard in `create-artifact.ts` — not a Round 8 item, observed intact.

---

## Verdict

**Not CONVERGED.** Four gaps found:

| New Finding | Severity |
|---|---|
| R9-V-001: unguarded `_initPos`/`_nodePos` in `resetBtn` handler | Medium |
| R9-SP-001: empty-string `fsmId` accepted by `readPendingPop` | Low |
| R9-SP-002: missing `last_transition_chain` field bypasses validation in `readState` | Low–Medium |
| R9-SP-003: empty-string `state_id` accepted; empty `states` object accepted | Low |
