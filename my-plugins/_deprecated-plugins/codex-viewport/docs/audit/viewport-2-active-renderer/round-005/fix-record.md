# Round 005 Non-Decisional Fix Record

## R1 — Render observation consistency

- `managed-renderer.ts` now creates one per-transaction component render cache.
- Commit preparation, managed paint, and committed snapshot use the same observation.
- `managed-render-content.ts` consumes the transaction render callback instead of rerendering components.
- Pin: `managed-runtime.test.ts` — `uses one component observation for prepare and paint`.

Residual decision: positive identity/finality evidence for opaque/custom components remains open.

## R2 — Lifecycle and native-failure fencing

- Duplicate `finishRun()` during drain is idempotent.
- `disposed` is absorbing.
- A successor run arriving during drain synchronously returns the old patch to native before entering.
- Width redraw, native commit, and dirty-gate catch-up failures invalidate Pi's baseline before native ownership continues; unknown partial bytes are never retried blindly.
- Pins: `runtime-coordinator.test.ts`, `managed-runtime.test.ts`, `resize-epoch.test.ts`.

Residual decision: whether temporary native fallback must recapture within the same run remains open.

## R3 — Snapshot epoch/resource ownership

- `CoordinatedSnapshot` gives each runtime one abortable snapshot epoch.
- Capture, finish, shutdown, and patched TUI stop synchronously cancel the lease and drop old-epoch blocked bytes.
- Native snapshots patch `stop` during the lease so direct stop cannot be followed by stale replay.
- Blocked output is capped at 64 MiB; cap overflow cancels the lease and requests catch-up.
- `ps` and `osascript` use AbortSignal and a five-second timeout.
- Pins: `snapshot-lifecycle.test.ts`, `resolve-controlling-tty.test.ts`, `terminal-app-capture.test.ts`.

## R4 — Snapshot publication

- Parent directories are opened with `O_DIRECTORY|O_NOFOLLOW` and set to `0700`.
- Timestamp directories and artifact files are exclusively created.
- Artifact files are `0600`, synced, and the timestamp directory is synced.
- `latest.json` is written to an exclusive temporary file, synced, atomically renamed, then the root directory is synced.
- Unpublished failed generations are removed.
- Pin: `snapshot-artifacts.test.ts` symlink/collision cases.

## R5 — Frame bounds and diff totality

- Cursor coordinates must be integers inside frame width/height.
- Previous-only addressable bottom rows are explicitly erased.
- Relinquishing top rows is rejected rather than silently clearing stable content.
- Pin: `fixed-frame.test.ts` cursor and previous-only-row cases.

Residual decision: complete physical trailing-row/terminal-mode handoff attestation remains open.

## R6 — DSR single-flight ownership

- `TerminalCursorQueryOwner` is session-owned.
- A new DSR query aborts and removes the old retained late filter before sending another query.
- Lifecycle cancellation removes retained filters even after the earlier promise settled.
- Pin: `query-terminal-cursor.test.ts` overlapping query/write-failure cases.

Residual boundary: Pi offers no priority listener API; an earlier third-party input listener may still consume/transform CPR before this plugin sees it.

## Verification

```text
78 tests / 16 suites passed
TypeScript plugin config passed
56 non-test TS files / 18 test files
all TS files <= 200 nonblank noncomment lines
git diff --check passed
```

This record is not a convergence claim. See `judge.md` and `scco-report.md`.
