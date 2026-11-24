# Round 005 SCCO lifecycle/resource challenge

## Review

- **Blocker:** an in-flight snapshot lease outlives runtime shutdown and can replay terminal bytes after `TUI.stop()`.
- **Blocker:** native width redraw failure abandons a possibly partial full-screen write without recovery and discards both the redraw and cleanup errors.
- **Blocker:** native commit failure restores ownership but does not restore terminal/native-baseline coherence.
- **Blocker:** repeated `session_start` suppresses failure while recovering the previous owner and can admit a new managed epoch after failed recovery.
- **Blocker:** dirty recapture catch-up errors are swallowed while the coordinator declares native fallback.
- **Note:** artifact persistence failures are converted to silent `undefined`, and direct concurrent artifact writes can leave an unpublished partial snapshot directory.
- **Correct:** entry/recapture generation guards, patch installation rollback, conditional method restoration, snapshot serialization, render reentrancy coalescing, and active DSR cleanup are sound on the inspected paths.

## Candidate L1 — snapshot lease survives shutdown/stop and replays stale bytes

**Severity:** Blocker

**Anchors**

- A snapshot lease replaces `terminal.write` and buffers every non-diagnostic write: `my-plugins/codex-viewport/snapshot-lease.ts:12-25`.
- Release restores the writer conditionally but replays buffered bytes unconditionally, with no `internals.stopped` or generation check: `my-plugins/codex-viewport/snapshot-lease.ts:40-52`.
- The lease spans two awaited physical captures: `my-plugins/codex-viewport/execute-snapshot.ts:21-53`.
- Coordinator shutdown has no reference to, cancellation of, or wait for the snapshot lease: `my-plugins/codex-viewport/runtime-coordinator.ts:116`, `my-plugins/codex-viewport/runtime-coordinator.ts:138-152`.
- Native snapshot release suppresses only render catch-up after stop, not buffered terminal replay: `my-plugins/codex-viewport/native-snapshot-target.ts:15-43`.
- Official Pi sets `stopped = true`, then emits terminal reset/cursor bytes, then stops the terminal: `packages/tui/src/tui.ts:687-711`.
- Official Pi performs runtime disposal before stop for signal shutdown and stop before runtime disposal for interactive shutdown, so both orderings are reachable: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3495-3519`.

**PRE**

`SnapshotActive ∧ terminal.write = interceptedWrite ∧ capturePhysical is pending`.

Required ownership invariant: shutdown must revoke all extension-owned terminal interception before terminal teardown, and no extension callback may emit/replay terminal bytes after `stopped`.

**Reachable trace**

1. `/tsnapshot` starts while managed or native and synchronously acquires a lease.
2. `executeSnapshot` reaches the first awaited `capturePhysical()` while `terminal.write` remains intercepted.
3. Interactive shutdown calls Pi `stop()` first. Pi's stop/reset bytes are buffered, and `terminal.stop()` completes. Signal shutdown instead runs plugin recovery first, buffering recovery/native redraw bytes, and then buffers Pi stop bytes.
4. Coordinator clears its patch/context and reaches `disposed`, but the snapshot promise still owns the interceptor.
5. Physical capture resolves later. `finally` invokes `lease.release()`.
6. Release calls captured `originalWrite` after terminal stop. If a replay write throws, the loop drops all later buffered bytes; `onRelease` still runs, masking that recovery/stop was never physically emitted at the intended time.

**POST violation**

`phase = disposed ∧ internals.stopped = true` can coexist with stale snapshot ownership and subsequent direct terminal writes. Shutdown's terminal-restoration POST condition is therefore not established.

**Pinning test**

Add a deferred-capture test for both managed and native targets:

1. Start `runtime.snapshot()` with the first physical capture promise held unresolved.
2. Instrument `terminal.stop()` and reject any `terminal.write` occurring after it.
3. Exercise both `runtime.shutdown(); tui.stop()` and `tui.stop(); runtime.shutdown()` orderings.
4. Resolve the captures.
5. Assert the interceptor was revoked before stop/recovery, no post-stop write occurred, no recovery bytes were silently buffered, and the snapshot terminates as cancelled/failed with an explicit journal event.

The fix needs a coordinator-owned cancellable snapshot lease. Shutdown/stop must synchronously revoke or settle interception before recovery/terminal teardown; merely checking `stopped` during replay would avoid post-stop corruption but would still lose Pi's stop bytes.

## Candidate L2 — partial native width redraw failure is silently abandoned

**Severity:** Blocker

**Anchors**

- Width mismatch invokes saved native `doRender`: `my-plugins/codex-viewport/runtime-patch.ts:153-156`.
- On throw, the patch disables itself, attempts one reset under `catch {}`, restores methods, calls a callback, and returns without native recovery: `my-plugins/codex-viewport/runtime-patch.ts:157-164`.
- The coordinator callback names the error `_error` and only clears ownership/changes phase: `my-plugins/codex-viewport/runtime-coordinator.ts:194-197`.
- The canonical recovery path resets modes, invalidates native baseline, and invokes native render: `my-plugins/codex-viewport/recover-native-renderer.ts:4-19`.

**PRE**

`phase = active-managed ∧ renderer outcome = width-changed ∧ originalDoRender may have emitted a strict prefix before throwing`.

Required transition invariant: mandatory native width reflow either commits a complete native frame or enters an explicit failed recovery state with the terminal normalized and the error surfaced.

**Reachable trace**

1. Terminal width changes during managed rendering.
2. Pi native redraw emits a destructive prefix such as `2J/3J`, then throws due to terminal I/O or component rendering.
3. The plugin's cleanup write may itself throw and is swallowed.
4. Patch ownership is removed and the coordinator enters `active-native-fallback`; the original redraw error is ignored.
5. No native baseline invalidation/redraw follows, and no warning reports the failure.

**POST violation**

The system declares native ownership while neither a complete native frame nor a successful recovery is proven. The physical screen and Pi private baseline may disagree.

**Pinning test**

Extend the width-reentry test with a native renderer that emits a destructive prefix then throws. Separately inject failure into the cleanup write. Assert that:

- both failures are observable (primary plus cleanup context),
- the runtime does not silently claim ordinary native fallback,
- native baseline is invalidated,
- no new managed entry is allowed until a complete native recovery succeeds.

## Candidate L3 — native commit failure restores methods without terminal recovery

**Severity:** Blocker

**Anchors**

- `commitNatively` first prepares/prime-checks handoff state, then invokes saved native `doRender`, returning `failed` on throw: `my-plugins/codex-viewport/native-commit.ts:13-27`.
- The failure branch disables the patch, restores methods, reports only `"native commit failed"`, and throws: `my-plugins/codex-viewport/runtime-patch.ts:180-188`.
- The outer render catch performs recovery only while `enabled`; this branch has already set it false: `my-plugins/codex-viewport/runtime-patch.ts:124-139`.
- Canonical reset/invalidate/redraw recovery exists but is not called: `my-plugins/codex-viewport/recover-native-renderer.ts:4-19`.

**PRE**

`managed handoff predicate = seamless ∧ native commit requested ∧ originalDoRender may partially write or throw after baseline preparation`.

Required atomic-commit invariant: after a failed native commit, ownership restoration alone is insufficient; terminal bytes and Pi's native baseline must be recovered before native fallback is announced.

**Reachable trace**

1. A committed mutation produces `native-commit`.
2. Handoff preparation establishes Pi baseline fields for the candidate frame.
3. Saved native renderer partially writes and throws.
4. The patch removes itself and `onReturned` moves the coordinator to fallback.
5. The rethrow reaches `render()` with `enabled = false`, so the catch intentionally does nothing.

**POST violation**

`owner = native` is announced with an unverified physical frame and potentially primed baseline. A warning exists, but no state repair occurs.

**Pinning test**

Inject a native commit renderer that writes a prefix then throws. Assert a terminal reset and baseline-invalidating recovery are attempted exactly once, the original error remains primary, and managed ownership cannot reactivate until recovery succeeds. The current test that checks only phase/method restoration is not sufficient.

## Candidate L4 — repeated session capture hides previous-owner recovery failure

**Severity:** Blocker

**Anchors**

- `capture()` cancels the current entry/patch and wraps prior return/recovery/disposal in `catch {}`: `my-plugins/codex-viewport/runtime-coordinator.ts:22-30`.
- It then clears context and captures a new TUI/phase: `my-plugins/codex-viewport/runtime-coordinator.ts:31-46`.
- Recovery restores methods before reset/native redraw and can return/throw an I/O or native-render failure: `my-plugins/codex-viewport/runtime-patch.ts:69-79`.
- Official `session_start` is repeatable for reload/new/resume/fork, not startup-only: `packages/coding-agent/src/core/extensions/types.ts:550-556`, `packages/coding-agent/src/core/agent-session.ts:2604`.

**PRE**

`old patch active ∧ new session_start arrives ∧ old native recovery may fail`.

Required owner-transfer invariant: a new session epoch may be admitted only after the previous renderer has relinquished ownership and restored a coherent native frame, or after an explicit terminal-failure state prevents re-entry.

**Reachable trace**

1. Managed renderer is active.
2. Extension reload/session transition emits another `session_start`.
3. `capture()` invokes synchronous recovery; reset or native redraw throws.
4. The broad catch suppresses the failure.
5. `capture()` binds the new context and may set `idle-native`.
6. A later `agent_start` can install a new managed patch over a terminal whose recovery failed.

**POST violation**

Failed old-owner recovery is indistinguishable from successful transfer. Error provenance is lost and a new generation is permitted.

**Pinning test**

While managed, inject a failing native recovery and call `capture(ctx)` again. Assert the failure is reported, phase remains a non-reenterable terminal-failure/native-fallback state, no new patch can be installed, and the original recovery error is preserved.

## Candidate L5 — dirty recapture catch-up failure is swallowed

**Severity:** Blocker

**Anchors**

- Gate renders set `gateRenderPending`; returning from the gate performs saved native catch-up when dirty: `my-plugins/codex-viewport/runtime-patch.ts:81-87`, `my-plugins/codex-viewport/runtime-patch.ts:142-150`.
- Recapture failure calls `returnWidthGateSafely`, clears the patch, and declares fallback: `my-plugins/codex-viewport/runtime-coordinator.ts:167-190`.
- `returnWidthGateSafely` suppresses every catch-up error: `my-plugins/codex-viewport/runtime-failure.ts:13-16`.

**PRE**

`phase ∈ {width-recapture-gate,native-commit-gate} ∧ gateRenderPending = true ∧ recapture fails`.

The design requires dirty-gate native catch-up before fallback. Therefore success of that catch-up is part of the phase-transition POST condition.

**Reachable trace**

1. Native redraw/commit enters a recapture gate.
2. A render arrives while no managed renderer exists, marking the gate dirty.
3. DSR times out or baseline recapture fails.
4. `failRecapture()` invokes native catch-up.
5. Saved native renderer throws; `returnWidthGateSafely` swallows it.
6. Patch reference is discarded and phase becomes `active-native-fallback`.

**POST violation**

The dirty update was not rendered, yet the system records successful return to native and loses the only patch object that knew catch-up was pending.

**Pinning test**

Enter a width gate with delayed/failed DSR, call patched `doRender()` to mark it dirty, then make saved native `doRender` throw during gate return. Assert the coordinator reports failure, retains a recoverable terminal-failure state, and does not clear ownership as though catch-up succeeded.

## Candidate L6 — snapshot artifact failure is silent and may leave partial output

**Severity:** Note

**Anchors**

- Artifact persistence rejection is caught and converted to `undefined`: `my-plugins/codex-viewport/execute-snapshot.ts:69-74`.
- Artifact files are direct concurrent writes, followed later by `latest.json`, without temp-file/rename publication: `my-plugins/codex-viewport/snapshot-artifacts.ts:24-64`.
- The command only notifies when a path is returned: `my-plugins/codex-viewport/codex-viewport.ts:20-31`.

**PRE/POST violation**

PRE: the lease/capture completed but one disk write fails. Required POST: the user receives a diagnostic failure and published snapshot state is either complete or absent. Current POST can be `undefined + no notification + partial timestamp directory`.

**Reachable trace**

One member of the artifact `Promise.all` succeeds and another fails (disk full, permission change, process interruption). The directory remains partial; `latest.json` is not updated; `executeSnapshot` suppresses the error and `/tsnapshot` says nothing.

**Pinning test**

Inject a write failure after one successful artifact write. Assert a warning includes phase/path/error, no partial directory is published, and `latest.json` remains atomically valid. Use a temporary directory plus rename for completed publication.

## Paths checked safe

- `runtime-patch-preflight.ts`: rejects existing `doRender` or `stop` owners and an existing codex owner before mutation.
- `runtime-patch.ts:35-67` plus `restore-runtime-patch-methods.ts`: constructor rollback and normal disposal remove only methods/markers still owned by this patch; foreign replacement is not overwritten.
- `runtime-coordinator.ts:49-101`, `managed-entry.ts:21-37`, `width-reentry.ts:20-42`, `begin-width-recapture.ts`: async activation is guarded by generation, phase, patch identity, abort identity, and a second currentness check before `activate`; inspected delayed-entry tests pin agent-end and shutdown non-resurrection.
- `runtime-snapshot-owner.ts:19-54`: managed snapshots are single-owner; concurrent acquisition is rejected; blocked render demand is coalesced to one catch-up request.
- `native-snapshot-target.ts:15-43`: native snapshot ownership of `doRender` is conditional and restored on lease creation failure/release; a second native snapshot is rejected because the first owns an instance method.
- `execute-snapshot.ts:21-68`: once execution enters its capture block, capture/render failures still reach one release attempt. This does not discharge L1 because lifecycle teardown is outside that block.
- `query-terminal-cursor.ts:17-82`: success and active abort clear timeout, abort listener, and input subscription. Timeout/write failure deliberately retain one unreferenced 1000 ms late-DSR filter, which has bounded cleanup and prevents a late DSR from entering normal input.
- `runtime-patch.ts:124-139`: synchronous render reentry is coalesced to one later render request; it does not create a second writer.
- `native-handoff.ts`: rejection paths do not update Pi baseline; baseline mutation occurs only after visible frame, geometry, cursor, image, and provenance checks succeed.
- `snapshot-journal.ts`, `snapshot-state.ts`, `snapshot-types.ts`, `terminal-app-capture.ts`: no independent persistent owner, timer, or subscription was found. State capture does execute component `render()` methods, but snapshot render blocking prevents the patched TUI writer from concurrently rendering.
- `snapshot-artifacts.ts`: permissions and session-id validation are bounded and explicit; publication atomicity remains the L6 note.
- `codex-viewport.ts`: one coordinator owns extension runtime state; event handlers do not create additional renderer/snapshot owners.

## Concise / Optimization analysis

Recovery is currently expressed through four inconsistent mechanisms:

1. canonical `recoverNativeRenderer` (reset, invalidate, native render),
2. width-redraw manual reset/restore/callback,
3. native-commit manual restore/callback/rethrow,
4. gate return with an error-swallowing wrapper.

This duplication directly explains L2, L3, and L5. Replace it with one native-transition finalizer whose result records: method ownership restored, terminal normalization result, baseline validity, native redraw/catch-up result, primary error, and secondary cleanup error. Clean gates may skip redraw only when `nativeFrameCurrent` is attested; dirty gates must not report fallback until catch-up succeeds. `onReturned` should fire exactly once from that finalizer.

Managed entry and width/native-commit recapture also duplicate DSR query, currentness checks, baseline capture, renderer construction, and activation (`managed-entry.ts` versus `width-reentry.ts`). A small `enterManagedEpoch` operation can own the common query/currentness/activation skeleton while keeping two explicit baseline strategies: initialize a new ledger on first entry, reuse/reconcile the ledger on recapture. Do not merge those semantic differences. Rename `beginWidthRecapture` to native recapture because it is also used after native commit.

Snapshot ownership should be a coordinator lifecycle resource, not only a patch-local flag. One abortable session lease should cover managed and native targets, be keyed to coordinator generation, and be synchronously revoked before recovery/stop. This removes the separate native/managed shutdown gaps without adding another writer.

The bounded late-DSR timer should remain: eliminating it would simplify code but allow a timed-out DSR to corrupt normal input. Its current cleanup is balanced; only a documented constant/name would improve proof readability.

## Evidence limits

- Root `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` was absent; the controlling plan read was `my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/plan.md`.
- Root `progress.md` contained only `In Progress` and no task/file notes.
- Relevant tests were inspected, including coordinator, managed runtime, event isolation, cursor query, and snapshot suites. No existing test interleaves a pending snapshot with stop/shutdown; no tests were executed during this read-only challenge.
