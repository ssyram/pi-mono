# Visualizer Subsystem — Correctness Audit (Round 8)

**Files audited**: `document.ts`, `create-artifact.ts`, `render-html.ts`, `label-layout.ts`, `normalize-state.ts`, `types.ts`
**Date**: 2026-04-24

---

## Findings

### R8-V-001 — Hardcoded `$START` as current state in file mode

**Severity**: Medium

**File**: `document.ts:103`

**Description**: `buildFileVisualizerDocument` always sets `currentStateId: "$START"` regardless of the FSM's actual initial state. If a flow's first state has a different ID, the current-state highlight in the visualizer will point to the wrong node (or no node at all if `$START` doesn't exist in that FSM).

**Counterexample**: A flow whose first state is `"idle"` will render with `currentStateId: "$START"`, causing no node to receive the `current` CSS class and the "Current" field in the sidebar to show `$START` — a state that doesn't exist.

**Note**: Session mode (`buildSessionVisualizerDocument:56`) correctly reads `runtime.current_state_id` from live runtime data, so this only affects the static file-preview path.

---

### R8-V-002 — `nodePos[s.id]` null-dereference crash on state/layout mismatch

**Severity**: High

**File**: `render-html.ts:520`

```js
.attr('transform', function(s) { var n = nodePos[s.id]; return 'translate(' + n.x + ',' + n.y + ')'; });
```

**Description**: `nodePos` is built from `layout.nodes` (output of `layoutFsm`). If any state in `fsm.states` has no corresponding entry in `layout.nodes`, `n` is `undefined` and `n.x` throws a TypeError, crashing the entire render for that FSM tab.

**Counterexample**: `layoutFsm` silently drops edges to unknown `nextStateId` values but still includes all states as nodes. However, if a state is added to `VisualizerFsm.states` after layout is computed (or if dagre fails to place a node), the mismatch produces a crash. The same pattern repeats at lines 436, 583–584, 591 for edge rendering and drag-node updates.

---

### R8-V-003 — `d.edge.action` undefined crash on edge label click/hover

**Severity**: High

**File**: `render-html.ts:496, 507`

```js
showTooltip(evt, '<b>' + esc(d.edge.action.id) + '</b>' + ...);  // line ~496
edgeLabels.on('click', function(_e, d) { showAction(d.edge.action); });  // line 507
```

**Description**: `action` is looked up via `actionMap[e.srcId + '\0' + e.tgtId + '\0' + e.actionId]`. If the key doesn't match (e.g., `e.actionId` from layout differs from `a.id` in the FSM), `action` is `undefined`. Both the mouseover tooltip and the click handler then dereference `undefined.id`, throwing a TypeError.

**Counterexample**: `label-layout.ts` uses `action.id` as the `actionId` key when building edges. If `normalize-state.ts` ever produces an action whose `id` differs from what layout stored (e.g., due to a future rename or ID collision), every hover/click on that edge crashes the page.

---

### R8-V-004 — Dangling transitions silently dropped from layout without warning

**Severity**: Medium

**File**: `label-layout.ts` (edge-building loop)

```ts
if (!stateIds.has(a.nextStateId)) continue;
```

**Description**: Transitions pointing to a state ID not present in the FSM's state list are silently skipped during layout. No warning is emitted, so the caller (and ultimately the user) has no indication that the rendered graph is incomplete.

**Counterexample**: An FSM with a transition `A → "nonexistent"` will render without that edge. The document builder's `warnings[]` array will not contain any mention of it. The user sees a graph that appears valid but is missing transitions.

---

### R8-V-005 — Non-ASCII / emoji action IDs produce undersized label boxes

**Severity**: Low

**File**: `label-layout.ts` (`estimateBox`)

```ts
width: text.length * 7 + 20
```

**Description**: Label box width is estimated using character count × 7px, which assumes single-byte ASCII characters. Multi-byte characters (CJK, emoji, accented letters) have the same `.length` as ASCII but render wider, causing the estimated box to be too narrow. The force-avoidance pass then operates on incorrect geometry, potentially leaving labels overlapping.

**Counterexample**: An action ID of `"確認"` (2 chars, `.length === 2`) gets a box width of `2 * 7 + 20 = 34px`, but the actual rendered width is ~28px per CJK character = ~56px. The label overflows its box and may overlap adjacent labels permanently.

---

### R8-V-006 — `dragNodesCode` interpolated raw into `<script>` block

**Severity**: Low (latent)

**File**: `render-html.ts:150`

```ts
${dragNodesCode}
```

**Description**: The string exported from `drag-nodes.ts` is embedded directly into the HTML `<script>` block with no escaping or validation. If `dragNodesCode` ever contains the literal `</script>`, it would prematurely close the script tag, breaking the page and potentially enabling script injection in contexts where the HTML is served to a browser.

**Current status**: `drag-nodes.ts` is static source code, so this is not currently exploitable. It becomes a risk if `dragNodesCode` is ever made dynamic or loaded from an external source.

---

## Dimensions with No Findings

| Dimension | Verdict |
|---|---|
| **Path security** | Clean. `create-artifact.ts` uses `resolve(cwd, path)` + `startsWith(normalizedCwd + sep)` guard on both `outputFile` and `flowFile`. No traversal possible. |
| **HTML injection** | Clean. All user-controlled strings reach the DOM via `esc()` (innerHTML) or `escapeHtml()` (`<title>`). `safeJson` correctly escapes `</script>` sequences (`<` → `\u003c`). |
| **Warning plumbing** | Clean. Both `buildSessionVisualizerDocument` and `buildFileVisualizerDocument` return `{ document, warnings }`. `createVisualizerArtifact` captures and forwards them in `VisualizerArtifactResult.warnings` without silent drops. |
| **normalize-state.ts** | Clean. Pure data mapping with no side effects, no path handling, no HTML output. All fields mapped 1:1 from FSM types. |

---

## Summary

| ID | Severity | Area |
|---|---|---|
| R8-V-001 | Medium | Data integrity — wrong `currentStateId` in file mode |
| R8-V-002 | High | Render correctness — null-deref crash on node lookup |
| R8-V-003 | High | Render correctness — null-deref crash on edge action lookup |
| R8-V-004 | Medium | Data integrity — silent drop of dangling transitions |
| R8-V-005 | Low | Layout correctness — non-ASCII label box underestimate |
| R8-V-006 | Low | Render correctness — raw `dragNodesCode` interpolation |
