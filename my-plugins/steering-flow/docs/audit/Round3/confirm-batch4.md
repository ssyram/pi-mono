# Audit Batch 4 — Independent Confirmation Report

**Reviewer**: Fresh reviewer (no prior audit context read)  
**Date**: 2026-04-24  
**Source root**: `my-plugins/steering-flow/`  
**Method**: Direct source reading only — `render-html.ts`, `label-layout.ts`, `document.ts`, `create-artifact.ts`, `normalize-state.ts`, `index.ts`, `storage.ts`

---

## D3-004 (MEDIUM) — REJECT

**Claim**: dagre layout may return edges with empty `points` array → `d3.line()` draws phantom lines or throws.

**Finding is wrong on two counts.**

**1. `d3.line()` is not used.** Edge paths in `render-html.ts` are built via manual `M…L…` string construction inside `polylineSplit()`. There is no `d3.line()` call anywhere in the rendering pipeline.

**2. Empty `points` is guarded.** `polylineSplit(pts, lx, ly)` opens with:
```ts
if (!pts || pts.length < 2) return { d1: 'M'+lx+','+ly, d2: 'M'+lx+','+ly }
```
This returns a degenerate zero-length path — invisible, not a phantom line, and no throw. The edge rendering block in `edgeGroups.each` also skips the circle-clamping step when `pts.length < 2`, so the guard is reached cleanly.

**Verdict**: The described failure mode does not exist. The premise (use of `d3.line()`) is factually incorrect, and the actual code has an explicit guard for the empty-points case.

---

## D3-005 (MEDIUM) — CONFIRM (with correction)

**Claim**: unknown `next_state_id` causes the visualizer to create phantom nodes.

**Confirmed as a real bug, but the failure mode is more severe than described.**

**Trace**:
- `label-layout.ts` calls `g.setNode(s.id, ...)` only for states in the input `states[]` array.
- It then calls `g.setEdge(s.id, a.nextStateId, ...)` for every action — **with no guard** that `a.nextStateId` was previously registered as a node. Dagre implicitly creates an internal node for the unknown ID.
- `layout.nodes` is built as `states.map(s => g.node(s.id))` — only explicitly declared states. The implicit dagre node does **not** appear here, so no phantom circle is rendered. The finding's label "phantom nodes" is imprecise.
- However, `for (const e of g.edges())` collects **all** dagre edges, including those to the implicit node. These edges carry real dagre-computed `points` arrays and appear in `layout.edges`.
- In `render-html.ts`, edge rendering accesses `d.tgtNode` (the target state's position object). For an unknown `nextStateId`, `d.tgtNode` is `undefined`. Line ~460:
  ```ts
  var t = d.tgtNode, last = pts.length-1, dx1 = pts[last].x - t.x
  ```
  This throws `TypeError: Cannot read properties of undefined (reading 'x')` — crashing the entire render, not just drawing a dangling line.

**Correction**: The bug is real and exploitable via programmatic FSM construction. The failure is a **render crash** (TypeError), not a visual phantom node. Severity may warrant upgrading to HIGH given the crash impact.

---

## D3-007 (MEDIUM) — PARTIAL REJECT

**Claim**: silent FSM load failures during visualization — if `readFsm`/`readState` fail, the user sees no error.

**Mostly rejected. One narrow edge case confirmed.**

**Error propagation chain** (session mode):
1. `storage.ts`: `readFsmStructure` returns `undefined` on ENOENT; throws `CorruptedStateError` on invalid shape. `readState` follows the same pattern.
2. `document.ts` (`buildSessionVisualizerDocument`): calls `loadRuntime` per FSM in the stack. If `!runtime`, it `continue`s (skips). After the loop, if `fsms.length === 0`, throws `Error("No readable steering-flow FSMs found in the active stack.")`.
3. `create-artifact.ts`: no internal try/catch — all errors propagate.
4. `index.ts`: `visualize-steering-flow` tool wraps `createVisualizerArtifact` in `withSessionLock` + try/catch, returning `❌ ${friendlyError(e)}` on any throw.

**Result**: For the all-fail case (every FSM in the stack is unreadable), the user sees a clear `❌` error message. Not silent.

**Confirmed edge case**: If 1-of-N FSMs in the stack is unreadable, `document.ts` silently `continue`s past it. The remaining FSMs render normally. The user receives no notification that one FSM was skipped. This is a real (if minor) silent degradation.

**File mode** (`buildFileVisualizerDocument`): calls `parseFlowConfig` + `buildFSM` — parse errors propagate and surface via the same index.ts catch. No silent failure path found.

**Verdict**: The broad claim of silent failure is rejected. The narrow case of partial-stack silent skip is confirmed.

---

## D3-008 (MEDIUM) — PARTIAL CONFIRM

**Claim**: FSM with no states or only `$START`/`$END` with no actions produces blank SVG with no error message.

**Session mode: NOT confirmed.** `buildSessionVisualizerDocument` in `document.ts` throws `Error("No active steering-flow stack to visualize.")` for empty stack, and `Error("No readable steering-flow FSMs found in the active stack.")` if all FSMs are unreadable. These propagate to the user as `❌` messages. A valid FSM with only `$START`/`$END` would have 2 states and render 2 nodes — not blank.

**File mode: CONFIRMED.** `buildFileVisualizerDocument` calls `parseFlowConfig` + `buildFSM` and passes `Array.from(parsed.states.values())` directly to the visualizer with no empty-states guard. If the parser produces zero states (e.g., a syntactically valid but empty `.flow` file), `render-html.ts` line ~511:
```ts
.selectAll('g').data(fsm.states).enter().append('g')
```
…adds nothing. The SVG renders blank with no error message shown to the user.

**Verdict**: Confirmed for file mode only. Session mode is protected by explicit guards in `document.ts`. The finding should be scoped to file-mode visualization.

---

## D4-001 (CRITICAL) — CONFIRM

**Claim**: `session_start` hook runs with zero lock coverage, enabling interleaving with concurrent tool calls.

**Fully confirmed.**

All tool registrations (`load-steering-flow`, `steering-flow-action`, `save-to-steering-flow`, `visualize-steering-flow`, `get-steering-flow-info`) and all command handlers in `index.ts` wrap their file I/O inside `withSessionLock(sessionId, async () => { … })`.

The `session_start` handler does **not**. It directly calls, outside any lock:
- `sweepTmpFiles(dir)`
- `readPendingPop(dir)`
- `popFsm(dir)`
- `deletePendingPop(dir)`
- `readStack(dir)`
- `readState(dir, topId)`
- `popFsm(dir)` (second call)

`withSessionLock` in `storage.ts` is a per-session promise-chain mutex. Any tool call arriving during `session_start` execution will acquire the lock immediately (since `session_start` never holds it) and begin mutating session files concurrently with the startup sequence.

Concrete race: `session_start` reads the stack, a concurrent `steering-flow-action` call writes a new state, then `session_start` reads the (now-stale) state and overwrites the stack — corrupting session state silently.

**Verdict**: Confirmed critical. Fix: wrap the entire `session_start` body in `withSessionLock(sessionId, async () => { … })`.

---

## Summary Table

| ID | Severity | Verdict | Notes |
|---|---|---|---|
| D3-004 | MEDIUM | REJECT | No `d3.line()` used; empty points guarded by `polylineSplit` |
| D3-005 | MEDIUM | CONFIRM (corrected) | Real bug — render crash (TypeError), not phantom node circles |
| D3-007 | MEDIUM | PARTIAL REJECT | Broad claim rejected; narrow silent-skip for 1-of-N unreadable FSMs confirmed |
| D3-008 | MEDIUM | PARTIAL CONFIRM | File mode only; session mode protected by document.ts guards |
| D4-001 | CRITICAL | CONFIRM | session_start fully outside withSessionLock; race condition with all tool calls |
