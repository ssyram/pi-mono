# Round 004-A Non-Decisional Fix Record

Judge A ordered only the following changes; decision-gated DSR, height, diagnostics, and terminal-support policy were not changed.

## Implemented

- Dirty `width-recapture-gate` direct `TUI.stop()` now calls `returnToNativeFromWidthGate()` before original stop and always reports ownership return to the coordinator.
- Coordinator aborts pending DSR recapture when patch ownership returns.
- Added normal and injected catch-up-failure direct-stop regression.
- Width wording now distinguishes one mandatory width-triggered full reflow from optional dirty native catch-up; Pi's independent full-render conditions remain authoritative.
- Removed verified dead/test-only production surface: `sameViewportArea`, `renderItemComponents`, baseline `expansion/originalOriginRow/displacedEntryRows`, `expandedViewport`, `poisoned-recovery`, plugin-only `clearOnShrink`, and `markRendered`.
- Retargeted the unique growth test to production `planLiveRegionGrowth()`.

## Explicitly preserved

- `TuiInternals.logDirectory` ABI validation.
- `ManagedRendererState.displacedEntryRows` handoff provenance guard and test.

## Verification

```text
59 tests / 12 suites / 0 failure
TypeScript plugin config pass
npm run check pass
git diff --check pass
mechanical dead-symbol scan: no production hits outside historical audit artifacts
```
