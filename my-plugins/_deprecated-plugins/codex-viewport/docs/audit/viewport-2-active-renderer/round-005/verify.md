# Round 005 Verification Sweep

## Independent reports

- `verify-render-lifecycle.md`
- `verify-snapshot.md`
- `verify-input-frame-docs.md`

Three fresh reviewers inspected source and ran available tests. Initial FAILs were handled as follows.

## Initial FAIL disposition

### V1 — disposed was not absorbing across `capture()`

UPHELD and fixed. `RuntimeCoordinator.capture()` now returns immediately from `disposed`. The existing disposed regression now calls `capture`, `finishRun`, and `startRun` after shutdown and asserts phase/method ownership remain disposed/native.

### V2 — partial native snapshot ownership installation leaked `doRender`

UPHELD and fixed. Both `doRender` and `stop` property installations are inside one guarded transaction; catch removes every identity still owned. `native-tui-snapshot.test.ts` injects failure on the second installation and asserts neither own method remains.

### V3 — snapshot publication might remove a pre-existing timestamp directory

REFUTED by source and strengthened test. `writeSnapshotArtifacts()` performs an exclusive non-recursive `mkdir(directory)` before entering the cleanup transaction. `EEXIST` therefore occurs before cleanup ownership is assumed. The collision regression now asserts the pre-existing directory and its symlink member both remain after rejection.

### V4 — live verification plan retained `59/12`

UPHELD and fixed. Current factual records report 78 tests / 16 suites, 56 non-test TS files, and 18 test files. Historical reports retain their original counts and are labeled historical where live design documents cite them.

## Final verification evidence

```text
focused post-fix: 15/15 passed
full plugin suite: 78/78 passed, 16 suites
TypeScript plugin config: passed
git diff --check: passed
all top-level TS files: <= 200 nonblank noncomment lines
```

## PASS claims

- one component observation per managed transaction;
- duplicate finish/drain successor/absorbing disposal;
- width/native-commit/dirty-gate baseline fencing without blind retry;
- snapshot cancellation before stop/shutdown/context transition;
- no stale blocked-byte replay after stopped boundary;
- five-second abortable `ps`/`osascript` capture;
- bounded blocked-output retention;
- no-follow/exclusive/synced artifact files and atomic synced latest pointer;
- plugin-owned DSR single-flight and stale-filter removal;
- cursor horizontal bound and previous-only addressable bottom-row erase;
- no clearing of relinquished top stable rows.

## Explicit non-PASS boundaries

- earlier Pi input listeners can still consume/transform DSR;
- native handoff does not yet prove every relevant terminal mode/trailing physical row;
- accepted ANSI/control grammar and terminal capability matrix remain undecided;
- component finality/identity evidence remains heuristic beyond the fixed byte-observation transaction;
- crop versus upward displacement and same-run fallback recapture remain decisions;
- partial terminal output has no rollback/physical-commit acknowledgement.

Round 005 verification passes for the implemented non-decisional fixes but the overall audit remains NOT PROVEN and not converged.
