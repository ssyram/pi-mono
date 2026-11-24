# Round 005 Final Counter-Challenge — F05/F06

## Review

- Correct: the repository-root `progress.md` contains only an empty progress skeleton. The requested repository-root `plan.md` does not exist. The Round 005 audit plan and findings pool were therefore used as the claim authority.
- Correct: ordinary runtime fallback is not evidence for F05. `runtime-patch.ts:69-80` routes ordinary failure through synchronous native recovery; `recover-native-renderer.ts:4-18` emits the reset sequence, invalidates Pi's baseline, and calls the saved native renderer. The broad version of F05 remains rejected.
- Correct: `SnapshotLease.release()` is idempotent and normal snapshot capture failures are release-protected by `execute-snapshot.ts:32-54`. That does not provide coordinator lifecycle ownership.
- Note: no tests were run and no implementation was edited. The reproductions below are the executable evidence required to retain the findings under the Round 005 convergence gate.

## Verdict summary

| Finding | Final verdict | Scope |
|---|---|---|
| F05 | **CONFIRMED, NARROWED** | Throwing native width redraw, failed native commit after baseline priming, and throwing dirty-gate catch-up. Not ordinary fallback. |
| F06 | **CONFIRMED, NARROWED** | Pending lease survives coordinator capture/shutdown/TUI stop and unconditionally replays buffered bytes. The alleged production `journal.begin()` startup leak is **DISPUTED** because official state and dependencies do not make that throw reachable after a newly acquired lease. |

## F05 — CONFIRMED, NARROWED

### Final disproof attempt

The ordinary-recovery counterargument does not reach the three surviving branches:

1. **Native width redraw failure.** On width change, the saved native `doRender()` is called before recapture. Its exception branch disables the patch, emits only a best-effort terminal reset, restores methods, reports `onWidthRedrawFailed`, and returns (`runtime-patch.ts:142-168`). It does not call `recoverNativeRenderer()`, does not call `invalidateNativeBaseline()`, and does not retry the saved native renderer. `RuntimeCoordinator.handleWidthRedrawFailure()` merely clears its patch reference and selects `active-native-fallback` (`runtime-coordinator.ts:192-198`). A fallback phase is therefore recorded without a proven native frame.

2. **Native commit failure.** `commitNatively()` first calls `prepareNativeHandoff()` and then converts a throwing saved native `doRender()` into `{ kind: "failed" }` (`native-commit.ts:13-27`). The patch's failed-result branch disables the patch, restores methods, reports return, and throws the original error (`runtime-patch.ts:180-191`). Because ownership was disabled before the throw, the enclosing ordinary-recovery route cannot establish canonical recovery. The handoff-primed Pi baseline is not invalidated in this branch.

3. **Dirty width-gate catch-up failure.** `returnToNativeFromGate()` restores native methods and calls the saved `doRender()` when a render became pending during the gate (`runtime-patch.ts:81-87`). Recapture failure invokes it through `returnWidthGateSafely()`, which suppresses every exception (`runtime-failure.ts:13-17`; `runtime-coordinator.ts:169-183`). The coordinator then clears the patch and records native fallback without knowing whether the catch-up frame completed.

The competing dual-failure-only narrowing is therefore rejected. Dual reset-plus-render failure is a residual of canonical recovery, but these three branches bypass canonical recovery before that residual is relevant.

### Official caller reachability

- `codex-viewport.ts:45-49` maps official `session_start` and `agent_start` events to `capture()` and `startRun()`.
- Width change is detected inside the installed render patch and reaches the saved official TUI renderer; official `TUI.doRender()` performs dimension handling and commits renderer baseline/cursor state only after terminal output (`packages/tui/src/tui.ts:1256-1311,1435-1442`). A terminal write or renderer exception can therefore occur before completion.
- `codex-viewport.ts:77-82` maps `agent_end` and `session_shutdown` to `finishRun()` and `shutdown()`. These lifecycle calls do not retroactively attest that a failed native render produced a complete frame.

No official caller supplies a stronger exception guarantee than the patch itself. The three counterexamples remain reachable at the renderer boundary.

### Executable reproduction requirements

Add focused cases to `my-plugins/codex-viewport/runtime-patch.test.ts` and run:

```sh
node node_modules/vitest/dist/cli.js --run my-plugins/codex-viewport/runtime-patch.test.ts
```

The tests must fail before a fix and pass after it:

1. **Width redraw:** enter managed mode, change terminal width, make saved `doRender()` write a destructive prefix and throw, and separately observe reset/recovery calls. Assert original methods are restored, coordinator phase is `active-native-fallback`, Pi baseline is invalidated, one canonical saved-native retry is attempted, the original error is reported, and no native-frame success is claimed without that retry.
2. **Native commit:** arrange a seamless managed/native handoff, make saved `doRender()` write a prefix and throw after `prepareNativeHandoff()`. Assert the primed baseline is invalidated, original methods are restored, canonical recovery is attempted exactly once, the original commit error remains observable, and managed ownership is not silently reactivated.
3. **Dirty gate:** hold width recapture pending, request a render so the gate becomes dirty, fail recapture, and make the saved catch-up `doRender()` throw. Assert the failure is observable rather than swallowed, coordinator ownership agrees with physical ownership, and fallback is not reported as proven until recovery succeeds.

## F06 — CONFIRMED, NARROWED

### Startup lease escape — DISPUTED for official production execution

There is mechanically code before the release-protected `try`: lease acquisition is followed by `journal.begin()`, `journal.record(...)`, and `dependencies.now().toISOString()` at `execute-snapshot.ts:19-24`; the `try/finally` starts later at `execute-snapshot.ts:32`. An injected invalid `Date` or externally preactivated journal can therefore strand a lease.

That is not yet an official production reproduction:

- Production supplies `now: () => new Date()` (`codex-viewport.ts:34-40`), whose immediate `toISOString()` is valid.
- `SnapshotJournal.record()` is non-throwing in ordinary execution (`snapshot-journal.ts:12-14`).
- `SnapshotJournal.begin()` throws only when that same journal is already active (`snapshot-journal.ts:7-10`). During an active managed snapshot, `RuntimeSnapshotOwner.begin()` rejects a second lease (`runtime-snapshot-owner.ts:20-30`). During an active native snapshot, the own `doRender` replacement makes `NativeSnapshotTarget.beginSnapshot()` reject a second lease (`native-snapshot-target.ts:15-24`). Thus a concurrent official `/tsnapshot` may hit the journal error, but it does not acquire the newly leaked lease alleged by the PoC.
- Release and `journal.finish()` have no asynchronous boundary between them (`execute-snapshot.ts:48-56`), so official JS execution cannot interleave a new lease into that interval.

Accordingly, “production startup can escape release” needs a real official throwing operation or reachable journal/owner desynchronization. A test that manually calls private `journal.begin()` proves only an injected state. Moving lease acquisition under `try/finally` is still prudent hardening, but the startup subclaim is not independently confirmed under official dependencies.

### Coordinator lifecycle and replay — CONFIRMED

The stronger lifecycle finding survives:

1. A lease replaces `internals.terminal.write` and buffers all non-diagnostic bytes (`snapshot-lease.ts:12-27`).
2. Release restores the writer and replays every buffered chunk before `onRelease`, with no TUI identity, generation, phase, stopped-state, or cancellation check (`snapshot-lease.ts:40-52`).
3. `RuntimeCoordinator.snapshot()` returns the promise without storing its lease or promise (`runtime-coordinator.ts:116-120`). `capture()`, `shutdown()`, recapture failure, and finish paths contain no lease cancellation, release, or wait (`runtime-coordinator.ts:22-47,138-190`).
4. Runtime patch disposal/stop also contains no `RuntimeSnapshotOwner` release operation. Render suppression only prevents a catch-up render while the owner is active; it does not revoke buffered output (`runtime-patch.ts:93-123,193-197`).
5. Official plugin wiring independently maps `/tsnapshot`, `session_start`, and `session_shutdown` to `snapshot()`, `capture()`, and `shutdown()` (`codex-viewport.ts:34-49,77-82`). Official session replacement emits shutdown followed by start for reload/new/resume/fork (`packages/coding-agent/src/core/agent-session-runtime.ts:167-172,212-215,299-325,341-344,385-397`; `packages/coding-agent/src/core/agent-session.ts:2584-2604`). No layer shown waits for the coordinator's pending snapshot.
6. Official shutdown has both orderings: signal shutdown disposes extensions before TUI stop, while interactive quit stops the TUI before extension disposal (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:3494-3519`). `TUI.stop()` marks the TUI stopped and then writes terminal reset/cursor bytes (`packages/tui/src/tui.ts:687-711`). Those writes can be buffered by the lease and emitted only when capture later resolves.
7. Session replacement does not isolate the physical sink: official interactive mode constructs the TUI with `ProcessTerminal`, whose `write()` forwards to process-global stdout (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:445-458`; `packages/tui/src/terminal.ts:454-466`). Releasing old TUI A's lease after TUI B is captured can therefore display A's buffered bytes in B's terminal epoch.

`release()` being idempotent and normally called in `finally` does not disprove this. The defect is that lifecycle transition does not force or fence that release, and release itself has unconditional replay semantics.

### Executable reproduction requirements

Add lifecycle cases to `my-plugins/codex-viewport/tui-snapshot.test.ts` and `native-tui-snapshot.test.ts`, then run:

```sh
node node_modules/vitest/dist/cli.js --run my-plugins/codex-viewport/tui-snapshot.test.ts my-plugins/codex-viewport/native-tui-snapshot.test.ts
```

Required failing-then-passing cases:

1. **Shutdown before stop:** hold the first `capturePhysical()` unresolved, start `/tsnapshot` through the coordinator, call `runtime.shutdown()` and then official `tui.stop()`, record sink length, resolve capture, and assert the interceptor was revoked during shutdown and no buffered recovery/stop bytes appeared after stop.
2. **Stop before shutdown:** repeat with `tui.stop()` before `runtime.shutdown()`. Assert stop bytes are not retained for later replay and resolving capture cannot write after the stopped boundary.
3. **Session replacement:** start snapshot A with capture paused, invoke `runtime.capture(ctxB)` exactly as the official repeated `session_start` handler does, queue a distinctive `"OLD"` byte sequence through A, resolve A, and assert no A-generation bytes reach the shared sink after B activation. Also assert A cannot request catch-up rendering against B's epoch.
4. **Direct-write ordering:** while a lease is active, queue an ordinary direct write, perform diagnostic rendering/state mutation, and release. Assert stale ordinary output is either cancelled or reconciled before publication; unconditional replay-before-catch-up is not acceptable evidence of consistency.
5. **Startup gap qualification:** use the public snapshot dependency seam with `now: () => new Date(Number.NaN)` and assert writer/method ownership is restored after `toISOString()` throws. Keep this labeled injected-dependency/API hardening unless a production throwing dependency is identified. Do not use private journal preactivation as evidence of official reachability.

## Final assessment

F05 cannot be disproved beyond rejecting its blanket wording: the exact width-redraw, native-commit, and dirty-gate branches release or discard managed ownership without completing canonical native recovery. **F05 is CONFIRMED, NARROWED.**

F06's pre-`try` structure is real, but the cited preactivated-journal PoC does not establish a production startup leak through official callers. Its coordinator-lifecycle defect is independently concrete: pending leases are neither owned nor fenced across capture, shutdown, stop, or replacement, and release unconditionally publishes old buffered bytes. **F06 is CONFIRMED, NARROWED; startup production reachability is DISPUTED.**
