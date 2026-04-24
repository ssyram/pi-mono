# CS-2 Fix: Stuck $END FSM Recovery

## Problem

When an FSM reaches `$END`, the code calls `persistRuntime` (writes state/tape to disk) then `popFsm` (removes FSM from stack and deletes directory). A crash between these two operations leaves a completed FSM permanently stuck on the stack.

## Changes

### storage.ts — Pending-pop marker helpers

Added three exported functions and a `PendingPop` interface:

- `writePendingPop(sessionDir, fsmId)` — atomically writes `pending-pop.json` with `{fsmId, timestamp}`
- `readPendingPop(sessionDir)` — reads the marker, returns `undefined` if absent
- `deletePendingPop(sessionDir)` — deletes the marker (ignores ENOENT)

All use existing `atomicWriteJson`/`readJsonStrict` internally.

### index.ts — Part B: Two-phase pop intent marker

In both `$END` code paths (`loadAndPush` and `actionCall`):

1. **Before** `persistRuntime`: write `pending-pop.json` marker (only when `reached_end` is true)
2. **After** `popFsm` succeeds: delete the marker

This ensures that if a crash occurs after persist but before pop, the marker survives as evidence that the pop was intended.

### index.ts — Part A: $END sweep on session_start

Added to the existing `session_start` hook handler (after `sweepTmpFiles`):

1. **Pending-pop recovery**: reads `pending-pop.json`; if present, completes the pop and deletes the marker
2. **$END state sweep**: iterates the FSM stack; for each FSM whose `current_state_id === "$END"`, calls `popFsm` to clean it up

Both recovery paths log via `ctx.ui.notify` with `"warning"` severity.

## Verification

`npx tsc --noEmit` passes with no new errors (pre-existing unrelated errors in `packages/tui` only).
