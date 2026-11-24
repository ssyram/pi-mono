# Round 006 Final Adjudication

## Verdict

**Repository-local code contract: PASS. Production-wide terminal claim: PARTIAL.**

Round 006 clean-room review found two confirmed blockers after the initial 78-test state:

1. `agent_end` was incorrectly treated as the idle boundary even though official `AgentSession` may run `agent.continue()` before `agent_settled`.
2. Snapshot direct stop cancelled the render lease but initially did not fence the later artifact-publication phase.

Both were fixed and pinned. The final handoff re-proof then rejected the inherited logical-tail model and replaced it with cursor-anchored physical-origin adoption.

## Accepted fixes

- Low-level `agent_end` records only; `agent_settled` drains. Continuation `agent_start` is idempotent in managed/gate phases.
- Snapshot release unfreezes rendering but transaction stop ownership remains until artifact completion. Managed and native direct stop abort the shared signal; default publication checks the signal before durable commit steps.
- Empty, `.` and `..` session path segments are rejected before filesystem mutation.
- Cap crossing cancels the snapshot transaction, drops retained blocked bytes, restores ownership, requests catch-up and forwards the crossing write.
- Entry stable rows use one physical/logical coordinate model.
- Handoff no longer assumes `nativeLines.length - height`. It derives the implicit origin from native and managed cursor rows, preserves an unattested pre-Pi terminal prefix, and proves the known suffix plus bottom slack.
- Native commit primes Pi baseline without invoking saved native `doRender`; this removes the duplicate component observation and commit flash path.
- `maxLinesRendered` adopts the current clean physical working area. A real official `TUI.doRender()` regression proves unchanged and subsequent-growth native renders do not emit `2J/3J`.

## Hoare summary

### Managed write and baseline adoption

**PRE**: one patch owner; width/height valid; no image/overlay/force sentinel; ledger reconcile succeeds; transaction-local component observations are stable.

**Invariant**: prepared prefix, physical frame and Pi native observation are source-equivalent; memory frontier/frame do not advance before terminal write; unknown physical prefix contains no native logical row.

**POST**: one managed write establishes the frame; ledger accepts once; native baseline fields describe the same logical tree and physical cursor; no second native/component render occurs; DSR recapture either establishes the next suffix epoch or fails open native.

### Short-session origin

Let `O = physicalCursorRow - nativeCursorLogicalRow` after the managed frame. For `O > 0`, Pi content starts below terminal row zero; this is the same implicit-origin state official Pi already has before takeover. Relative native movement remains `targetLogical - hardwareLogical`, so `O` cancels. Appended CRLF rows consume `O`; once `O = 0`, normal `previousViewportTop` scrolling begins. For `O < 0`, `previousViewportTop = -O` represents retained viewport rows below the logical tail.

### Snapshot closure

**PRE**: one coordinated transaction and one target lease.

**Invariant**: release restores the terminal writer/render path but retains stop fencing until `complete()`; abort reaches capture and artifact writer through one signal.

**POST**: success publishes once and removes hooks; shutdown/direct stop/cap crossing aborts, removes hooks, suppresses pre-commit publication and performs at most one catch-up. Atomic rename remains the filesystem commit boundary.

## Rejected findings

- “A colliding pre-existing snapshot directory is recursively deleted” was rejected: exclusive `mkdir(directory)` occurs before `directoryCreated=true`; `EEXIST` never enters cleanup ownership. Cleanup removes only a directory created by the current transaction.
- “`hardwareCursorRow - previousViewportTop` must equal absolute physical row” was rejected for short sessions. Official Pi itself carries a positive implicit terminal origin not represented by `previousViewportTop`; its differential row movements use logical deltas where the origin cancels.
- Out-of-band terminal mutation without cursor movement is outside the sole-writer contract, not a locally repairable handoff predicate.

## Decisions

- D1 overflow: retain pending crop; reject upward stable displacement.
- D2 finality: conservative positive evidence; opaque unknown remains pending.
- D3 terminal grammar: best-effort admission; production-wide proof remains partial.
- D4 fallback: remain native for the failed run; retry on next run, never blind same-run replay after unknown partial output.
- D5 handoff: cursor-anchored baseline adoption with known-suffix equality and no native commit render.
- D6 snapshot durability: atomic pointer rename is commit; post-rename root-sync failure may be visible despite a reported failure.

## Final evidence

```text
87 tests / 16 suites passed
TypeScript plugin config passed
git diff --check passed
56 non-test TS files / 19 test files
all TS files <= 200 nonblank noncomment lines
```

The failed specialist-agent launch was infrastructure-only (`anthropic` credentials unavailable); three fresh generic reviewers and two focused re-reviews were used instead. Two final focused reviewers timed out after reporting no blocker; their partial conclusions agreed that short-session origin is consumed by append scrolling and transaction/cancel paths were safe.
