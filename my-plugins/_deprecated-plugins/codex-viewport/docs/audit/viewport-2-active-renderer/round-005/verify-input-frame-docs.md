# Round 005 Independent Fix Verification C

## Review

- Correct: The requested focused tests passed: `12/12` tests in `2/2` suites.
- Correct: The full plugin suite passed: `77/77` tests in `16/16` suites, with no failures, cancellations, skips, or todos.
- Correct: `npx tsc -p my-plugins/codex-viewport/tsconfig.json` exited successfully with no output.
- Blocker: none for the bounded plugin fixes.
- Note: `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` does not exist. Root `progress.md` contains only an empty `In Progress` scaffold. The available Round 005 plan at `my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/plan.md` was therefore used as the audit plan.

## Claim verdicts

### 1. Session-owned DSR single-flight — PASS

Source proof:

- `runtime-coordinator.ts:17-21` creates one `TerminalCursorQueryOwner` as a `RuntimeCoordinator` instance field.
- `runtime-coordinator.ts:90-96` passes that owner into initial managed entry.
- `runtime-coordinator.ts:170-179` passes the same owner into recapture entry, including both width and native-commit recapture phases.
- `managed-entry.ts:26-34` and `width-reentry.ts:24-32` call `cursorQueryOwner.begin()` for their DSR query.
- `terminal-cursor-query-owner.ts:4-9` aborts the current owner signal before publishing a new one.
- `runtime-coordinator.ts:196-203` calls `cursorQueryOwner.cancel()` during entry/session cancellation.

This proves single-flight for the plugin's own session entry and recapture queries. The owner is coordinator/session-owned rather than module-global.

Residual boundary: this does not serialize cursor queries owned by other extensions or by unrelated Pi internals.

### 2. Late-filter abort and own-query overlap — PASS

Source proof:

- `query-terminal-cursor.ts:25-42` cleanup clears the normal timeout and retained-filter timeout, removes both abort listeners, unsubscribes the Pi input handler, and optionally replays buffered non-report input.
- `query-terminal-cursor.ts:45-51` retains a timed-out or write-failed response filter for the bounded late-response window.
- `query-terminal-cursor.ts:77-82` makes either entry abort or owner abort run `cleanup(true)`, including after the query promise has already settled.
- `query-terminal-cursor.ts:58-63` consumes a matching late CPR and removes the retained handler.
- `query-terminal-cursor.test.ts`, tests `consumes a late DSR response after timeout`, `removes an old late filter before the next query`, and `removes the response filter when ownership is aborted after a write failure`, all passed in both focused and full runs.

Fixed boundary: a new plugin-owned query aborts and removes the previous plugin-owned retained late filter before the new query proceeds. Lifecycle cancellation also removes it. This fixes own-query overlap.

Residual boundary: absent a next query, matching late CPR, or lifecycle abort, the filter intentionally remains for up to `1000ms`. That is bounded retention, not permanent listener leakage.

### 3. Earlier-listener competition — FAIL (explicitly unfixed external boundary)

Official Pi dispatcher proof:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2082-2097,2118-2124` routes extension `onTerminalInput` registrations into the shared TUI `addInputListener` collection.
- `packages/tui/src/tui.ts:649-657` adds listeners to a `Set` and exposes only deletion/unsubscribe; there is no priority registration API.
- `packages/tui/src/tui.ts:763-785` iterates listeners in collection order, returns immediately when one returns `{ consume: true }`, and passes a listener's `{ data }` replacement to later listeners.

Therefore an earlier third-party listener can consume CPR before codex-viewport receives it, or transform the bytes seen by codex-viewport. Session-owned single-flight does not and cannot repair this dispatcher-level competition. Current tests correctly do not claim otherwise.

Residual boundary: end-to-end exactly-once DSR ownership is not proven under arbitrary competing Pi extensions.

### 4. Cursor frame validation — PASS

Source proof:

- `inline-viewport-frame.ts:21-26` requires integer cursor coordinates and enforces `0 <= row < area.height` and `0 <= column < area.width`.
- `fixed-frame.test.ts:45-54` rejects `column: 10` and accepts `column: 9` for width `10`; the test passed.

The prior off-by-one acceptance of `column === width` is fixed.

Residual boundary: this validates frame coordinates, not the semantic safety of arbitrary ANSI/control content inside row strings; terminal grammar remains a separate unproved area in the Round 005 SCCO report.

### 5. Previous-only bottom-row erasure — PASS

Source proof:

- `screen-frame-diff.ts:10-14` erases rows in `[next.area.bottom, min(previous.area.bottom, next.area.terminalHeight))`, exactly the previous-only bottom rows that remain addressable in the new terminal.
- `fixed-frame.test.ts:56-62` asserts the expected erase sequence for the old bottom row; the test passed.

Residual boundary: rows beyond the new terminal height are deliberately not addressed. Physical terminal equivalence after partial write failure remains outside this helper-level proof.

### 6. No top stable row is cleared — PASS

Source proof:

- `screen-frame-diff.ts:7-9` throws before producing output when `next.area.top > previous.area.top`; the diff cannot relinquish and erase former top rows.
- `screen-frame-diff.ts:15-19` paints only rows within the next inline area.
- The bottom-erasure loop at `screen-frame-diff.ts:10-14` starts at `next.area.bottom`, never above `next.area.top`.
- The full suite passed `does not clear stable rows above the first unfinished component` and `grows downward then crops live overflow without scrolling stable rows`.

No code path in `diffInlineViewport` emits `EL2` for a stable row above the next viewport. Top relinquishment is rejected rather than cleared.

Residual boundary: this is a proof of generated diff addresses. It does not establish safety against control sequences embedded in rendered row content.

### 7. Documentation/evidence counts and status — FAIL (counts are current in central records, but one live document remains stale)

Verified current evidence:

- Actual inventory is `56` non-test TypeScript files and `18` `*.test.ts` files.
- Actual full test result is `77 tests / 16 suites`, all passing.
- `docs/correctness-audit.md:20-23`, `docs/design/known-state.md:39-41`, `round-005/fix-record.md` under `Verification`, and `round-005/scco-report.md` report those current counts.
- Current status is not overclaimed: `docs/correctness-audit.md:3` says `NOT PROVEN`; the SCCO report marks Sound, Complete, Concise, and Optimization partial and records convergence as `FAILED`.
- Historical `round-005/judge.md` records its pre-fix `52/16` inventory and `65` tests; as a frozen pre-fix judgment, that is evidence history rather than a current-count claim.

Failure:

- `docs/design/detail/verification-plan.md:10` still labels `59 tests / 12 suites` as current (`当前`), contradicting the executable `77/16` result and the central current records.

Residual boundary: older audit/design documents also retain `59/12` evidence. Those are acceptable only where clearly labeled historical. The live verification plan is not so labeled, so repository-wide documentation count consistency does not pass.

### 8. Source files at or below 200 LOC — PASS

A code-only count excluding blank lines and comment-only lines covered all `56` top-level non-test TypeScript files. Maximums:

- `runtime-coordinator.ts`: `200`
- `runtime-patch.ts`: `200`
- `test-tui-context.ts`: `200`
- `managed-renderer.ts`: `186`

All remaining source files are below those values. The source limit passes, with three files exactly on the boundary.

Residual boundary: raw physical line counts are higher for some files; this verdict uses the repository's documented metric, `nonblank noncomment lines`.

## Verification commands

```text
node --test --import tsx my-plugins/codex-viewport/query-terminal-cursor.test.ts my-plugins/codex-viewport/fixed-frame.test.ts
# 12 tests, 2 suites, 12 pass, 0 fail

node --test --import tsx my-plugins/codex-viewport/*.test.ts
# 77 tests, 16 suites, 77 pass, 0 fail

npx tsc -p my-plugins/codex-viewport/tsconfig.json
# exit 0, no diagnostics
```

## Final assessment

The code fixes for plugin-owned DSR single-flight, retained-filter abort cleanup, cursor bounds, previous-only bottom erasure, and top stable-row protection pass source inspection and regression execution. The fix must remain described narrowly: own-query overlap is fixed; competition from an earlier Pi input listener is not fixed. Round 005 remains correctly not converged/not proven. Documentation verification is the only requested area that fails because `docs/design/detail/verification-plan.md:10` still presents the obsolete `59/12` count as current.
