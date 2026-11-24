# Round 005 SCCO adversarial/state-machine challenge

## Review

- Correct: `ManagedRenderer.render()` delays ledger acceptance and tracked-frame mutation until `terminal.write()` returns successfully, and cancels the prepared ledger transaction on a thrown write (`my-plugins/codex-viewport/managed-renderer.ts:72-130`).
- Correct: committed components are checked for disappearance, order change, and normalized render mutation before continued managed rendering (`my-plugins/codex-viewport/managed-renderer.ts:154-169`, `my-plugins/codex-viewport/transcript-ledger.ts:149-181`).
- Correct: width recapture is generation-, phase-, patch-, and abort-identity guarded, so a late DSR cannot activate a superseded renderer (`my-plugins/codex-viewport/runtime-coordinator.ts:174-213`, `my-plugins/codex-viewport/width-reentry.ts:20-43`).
- Correct: native handoff requires stable-row attestation, enough finalized rows, exact visible-frame equality, cursor equality, and no terminal images before mutating Pi's native baseline (`my-plugins/codex-viewport/native-handoff.ts:20-93`).
- Blocker candidate: snapshot interception can prevent synchronous native recovery during `stop()`, then replay recovery bytes after the TUI has stopped (`my-plugins/codex-viewport/snapshot-lease.ts:13-56`, `my-plugins/codex-viewport/runtime-patch.ts:107-141`). Candidate A2.
- Blocker candidate: repeated `finishRun()` can report `idle-native` while leaving an active managed patch installed (`my-plugins/codex-viewport/runtime-coordinator.ts:127-150`). Candidate A1.
- Note: `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` did not exist. The requested `progress.md` existed but contained only an empty in-progress template. Scope was therefore derived from the production source graph. No existing `docs/audit` content was read.
- Note: severities below are challenger estimates only. This is a low-threshold candidate pool, not adjudication.

## Source-consumer inventory

The active renderer's production construction sites are `managed-entry.ts:28-34` and `width-reentry.ts:29-38`. Its direct owner/dispatcher is `runtime-patch.ts:47-201`; state is also consumed by `native-handoff.ts`, `native-commit.ts`, and `snapshot-state.ts`. Runtime transitions are owned by `runtime-coordinator.ts` and entered from extension event consumers in `codex-viewport.ts`. Geometry and output dependencies inspected were `native-entry-baseline.ts`, `inline-viewport-area.ts`, `inline-viewport-frame.ts`, `managed-height-rebase.ts`, `live-region-growth.ts`, `viewport-expansion.ts`, `volatile-region.ts`, `screen-frame-diff.ts`, `terminal-render-plan.ts`, `cursor-placement.ts`, `stable-screen-rows.ts`, and `render-pi-lines.ts`. Ledger/component dependencies inspected were `component-ledger-reconciler.ts`, `transcript-ledger.ts`, `component-shapes.ts`, and `managed-render-content.ts`. DSR, recovery, image/overlay, snapshot, and session consumers were also inspected.

## Candidate pool

### A1. A second end event or finish call orphans an active draining patch

- Severity: Critical state-machine integrity.
- Exact path: `my-plugins/codex-viewport/runtime-coordinator.ts:127-150` (`finishRun`); downstream event gate at `my-plugins/codex-viewport/codex-viewport.ts` (`agent_end` and `runtime.isManaged()` guards).
- Invariant: `phase === "idle-native"` implies no installed/active runtime patch and native `doRender`/`stop` ownership.
- Reachable sequence: enter `active-managed` -> first `finishRun()` sets `draining-handoff` and calls `beginDrain()` -> before the requested drain render executes, call `finishRun()` again -> final branch sets `idle-native` without clearing, disposing, or recovering `this.patch`.
- Consequence: the TUI remains patched, but `isManaged()` is false. Subsequent assistant/tool lifecycle events are dropped, snapshots choose the native target and reject it because `doRender` is still an own property, and a new `startRun()` rejects because the phase/ownership contradict each other.
- Deterministic test/PoC: add `runtime-coordinator.test.ts` case `does not enter idle-native while drain patch is active`. Activate managed mode, call `finishRun()` twice without servicing `requestRender`, then assert either the phase remains `draining-handoff` or `Object.hasOwn(tui, "doRender") === false`. Current code yields `idle-native` with the own patch still installed. Then emit a new assistant event and verify it is not silently lost.

### A2. Snapshot ownership violates synchronous stop recovery

- Severity: Critical terminal/session corruption.
- Exact path: write interception/replay in `my-plugins/codex-viewport/snapshot-lease.ts:13-56`; render blocking in `runtime-snapshot-owner.ts:16-54`; synchronous stop/recovery in `runtime-patch.ts:65-79,107-141`; native recovery in `recover-native-renderer.ts:4-21`.
- Invariant: before the original TUI `stop()` runs, managed terminal modes are reset and a native frame is physically written; no bytes are written after the terminal is stopped.
- Reachable sequence: begin managed snapshot -> hold `capturePhysical()` pending after lease installation -> call patched `tui.stop()` -> `recoverNativeRenderer()` writes reset/full-redraw bytes through the snapshot interceptor while `diagnostic === false` -> bytes are put in `blockedOutput`, not the terminal -> original `stop()` runs -> snapshot later releases and replays those bytes after stop.
- Consequence: stop is not synchronously native-safe, baseline state can advance without corresponding physical output, and replay can target a stopped/closed or repurposed terminal.
- Deterministic test/PoC: add `snapshot-artifacts.test.ts` or `managed-runtime.test.ts` case with a deferred first physical capture and an underlying terminal write log that records whether `tui.stopped` is true. Start `runtime.snapshot()`, wait until the lease is active, call `tui.stop()`, resolve capture, and assert recovery bytes occurred before `stopCalls` and no write occurred with `stopped === true`. Current behavior blocks then replays them after stop.

### A3. Session replacement during a snapshot can replay old-session recovery bytes late

- Severity: High cross-session isolation.
- Exact path: `RuntimeCoordinator.capture()` in `my-plugins/codex-viewport/runtime-coordinator.ts:25-56`; lease replay in `snapshot-lease.ts:43-55`; `executeSnapshot()` holds the lease across asynchronous physical captures at `execute-snapshot.ts:20-69`.
- Invariant: replacing session context leaves no asynchronous owner capable of writing terminal bytes from the replaced session.
- Reachable sequence: managed snapshot with deferred physical capture -> `capture(newCtx)` cancels and recovers the old patch -> recovery writes are intercepted into the old lease -> new session is installed -> old snapshot releases and replays old recovery/native frame bytes.
- Consequence: bytes from session A can appear after session B owns the runtime, or can be sent to a terminal that session A already shut down.
- Deterministic test/PoC: start a snapshot against `oldTui` with a deferred capture, call `runtime.capture(newCtx)`, mark old terminal closed, resolve capture, and assert no old-terminal writes occur after replacement. Also assert new session phase/physical contents are unaffected. Current lease retains and replays the old writes.

### A4. Native-commit render failure restores native ownership with an attested but physically false baseline

- Severity: High terminal corruption.
- Exact path: baseline mutation in `native-handoff.ts:65-92`; native invocation in `native-commit.ts:14-28`; failure branch in `runtime-patch.ts:181-193`.
- Invariant: after a failed or partial native render, Pi's cached `previousLines`, width/height, viewport, and cursor state must be invalidated before native ownership is restored.
- Reachable sequence: finalize enough rows to obtain `native-commit` -> `prepareNativeHandoff()` succeeds and mutates Pi baseline fields -> `originalDoRender` emits a partial terminal prefix and then throws -> `commitNatively()` returns `failed` -> patch is disabled/restored and coordinator enters native fallback, but no `invalidateNativeBaseline()` or forced native recovery occurs.
- Consequence: the next native render may diff against the pre-attested or partially advanced baseline and emit too little or nothing, leaving the physical terminal corrupted.
- Deterministic test/PoC: in `managed-runtime.test.ts`, make native `doRender` update `previousLines`/`previousWidth`, write a destructive prefix, then throw. Trigger native commit, then call restored native `doRender`. Assert the failure path invalidated the baseline and the next render performs a full redraw. Current branch restores methods without invalidation or redraw.

### A5. Width-redraw failure has the same false-baseline escape hatch

- Severity: High terminal corruption.
- Exact path: width transition and catch branch in `my-plugins/codex-viewport/runtime-patch.ts:151-168`; coordinator failure transition in `runtime-coordinator.ts:213-217`.
- Invariant: a throwing native width redraw cannot return normal native ownership with potentially current-looking native cache fields.
- Reachable sequence: managed render observes new width -> calls original native redraw -> native renderer writes a clear/redraw prefix, updates some cache fields, then throws -> catch writes only mode/scroll-region/cursor reset bytes, restores methods, and enters fallback.
- Consequence: resetting modes does not reconstruct erased rows or invalidate a cache already updated by the partial native renderer.
- Deterministic test/PoC: extend `resize-epoch.test.ts` so the fake native renderer writes `ED2`, updates `previousWidth` and `previousLines`, then throws. After fallback, invoke native rendering and assert a forced full redraw. A byte-prefix-only throw is insufficient; the injected failure must occur after cache mutation to expose this path.

### A6. Prepared finalized content is rendered again after its bytes are chosen

- Severity: Medium state/physical attestation mismatch.
- Exact path: prepared-line rendering in `managed-renderer.ts:132-147`; post-write snapshot capture in `managed-renderer.ts:163-170`; later mutation assertion at `managed-renderer.ts:154-162`.
- Invariant: the committed component snapshot must describe the same component output whose bytes were accepted into the physical stable frame.
- Reachable sequence: a finalized component returns `A` from the render used to build `prepared.lines`, then `B` from the render used by `acceptPrepared()` after terminal write -> physical/stable preview accepted `A`, but committed snapshot records `B`.
- Consequence: if later renders remain `B`, mutation detection passes while the committed snapshot and native component output disagree with the accepted physical row. The mismatch is deferred to native handoff/recovery instead of rejected transactionally before write.
- Deterministic test/PoC: add `managed-runtime.test.ts` component whose `render()` returns `A` on the prepared call and `B` thereafter. Finalize it, render once, and assert either no write is accepted or the stored snapshot equals the accepted prepared lines. Instrument the terminal bytes and component call count; current code can accept `A` and snapshot `B`.

### A7. Multiple transient opaque suffix components cause premature finalization

- Severity: Medium normal-output fallback.
- Exact path: opaque-tail rule in `my-plugins/codex-viewport/component-ledger-reconciler.ts` (`reconcile`, approximately lines 55-88); immutable committed checks in `managed-renderer.ts:154-162`.
- Invariant: all transient/pending suffix components remain live until lifecycle or structural evidence establishes finality; being second-to-last is not sufficient evidence.
- Reachable sequence: append two non-assistant/non-tool transient chat components `pendingA`, `pendingB` -> reconciliation preserves only the exact last component as pending and finalizes `pendingA` -> commit prefix advances -> mutate or remove `pendingA` on the next update.
- Consequence: ordinary multi-part pending UI is treated as immutable transcript, causing `committed component mutated/disappeared` and permanent native fallback.
- Deterministic test/PoC: in `transcript-ledger.test.ts` or `managed-runtime.test.ts`, append two opaque components, render, update the first while retaining both, and render again. Assert both remain live and managed mode continues. Current tail-identity heuristic finalizes the first.

### A8. Recoverable UI states permanently disable managed behavior for the run

- Severity: High availability/feature correctness.
- Exact path: permanent native fallback outcomes in `managed-renderer.ts:76-111`; dispatch in `runtime-patch.ts:194-200`; coordinator transition in `runtime-coordinator.ts:220-230`. Normal triggers include tool expansion change, visible overlay, terminal image detection, and editor/footer not fitting after height shrink.
- Invariant: temporary/recoverable UI states may gate or temporarily hand control to native rendering, but must permit managed recapture when the state clears; normal UI behavior must not disable the viewport for the remainder of the run.
- Reachable sequences:
  - toggle tools expanded once and then restore it;
  - show an overlay for one frame and close it;
  - shrink height below mandatory rows and grow it again;
  - render one image-bearing component, then finalize/remove it.
- Consequence: all lead to `active-native-fallback`; no transition recaptures managed ownership during the same run. Existing fallback behavior is therefore not an acceptable resolution for these normal sequences.
- Deterministic test/PoC: parameterize `managed-runtime.test.ts`/`resize-epoch.test.ts` over the four triggers. Clear the trigger, request another render, and assert eventual `active-managed` with patched ownership restored. Current code remains native fallback.

### A9. Overlay visibility can become true after preflight but before managed terminal write

- Severity: Medium overlay corruption/flicker.
- Exact path: overlay preflight in `managed-renderer.ts:76-111`; subsequent component rendering and write in `managed-renderer.ts:72-130`.
- Invariant: no managed frame bytes are emitted while a visible overlay owns the screen.
- Reachable sequence: preflight observes no overlay -> a component's synchronous `render()` opens or makes an overlay visible and requests a reentrant render -> current render continues and writes managed frame bytes -> only the deferred render sees the overlay and falls back.
- Consequence: the current write can erase or overwrite the newly visible overlay.
- Deterministic test/PoC: component `render()` sets `tui.visibleOverlay = true` and calls `tui.doRender()` once. Assert the outer call emits no managed frame after visibility changes. Current preflight is not revalidated before write.

### A10. Image exclusion recognizes only Kitty and iTerm inline-image prefixes

- Severity: Medium to High terminal escape containment.
- Exact path: `my-plugins/codex-viewport/kitty-image-block.ts:1-5`; normalization consumer in `render-pi-lines.ts:13-28`.
- Invariant: any terminal image/control protocol whose rendering is not row-local and text-diff-safe must force a controlled native gate, not enter the managed row diff.
- Reachable sequence: component returns Sixel (`ESC P ... q ... ESC \\`) or another non-row-local graphics sequence; `containsTerminalImage()` checks only `ESC_G` and `OSC 1337;File=` and returns false; managed diff emits the graphics bytes inside an absolute-row repaint.
- Consequence: graphics can paint outside the viewport, survive text clears, or leave undeleted image state; Pi's image bookkeeping is bypassed.
- Deterministic test/PoC: extend the image case in `managed-runtime.test.ts` with a minimal Sixel payload and a fake terminal parser that marks graphics state. Assert no managed terminal plan contains the payload and that managed mode can later recapture rather than permanently disabling. Current predicate admits it.

### A11. DSR timeout retention can delay input and race the next entry query

- Severity: Medium input/state-machine isolation.
- Exact path: timeout and one-second late filter in `my-plugins/codex-viewport/query-terminal-cursor.ts` (`queryTerminalCursor`, approximately lines 24-104); entry consumers at `managed-entry.ts:20-40` and `width-reentry.ts:20-43`.
- Invariant: a failed entry query must not consume, delay, or steal input/DSR belonging to a later entry epoch.
- Reachable sequence: first DSR times out at 150 ms -> its input filter remains registered for up to 1000 ms -> finish/restart or replace session and start a new entry within that window -> emit the second query's DSR, adjacent user bytes, or a partial `ESC [` prefix.
- Consequence: depending on input-handler ordering, the old filter can consume the new DSR, causing a second timeout; a user byte suffix matching the DSR prefix can also remain buffered until late cleanup.
- Deterministic test/PoC: `query-terminal-cursor.test.ts` should use a multi-handler dispatcher honoring consume/remaining semantics. Time out query 1, start query 2 before 1000 ms, send one CPR adjacent to `x`, and assert query 2 resolves and `x` is delivered exactly once immediately. Also send a partial `ESC [` and assert it is not delayed for the full late-filter interval after query ownership has ended.

### A12. Direct terminal writes blocked during snapshot are replayed after diagnostic mutation without guaranteed catch-up

- Severity: High physical/logical desynchronization.
- Exact path: `snapshot-lease.ts:13-56`; catch-up depends only on blocked `doRender` in `runtime-snapshot-owner.ts:40-53`; diagnostic `renderOnce()` in `runtime-patch.ts:91-105`.
- Invariant: replay of bytes not represented in renderer state must either be prohibited or be followed by a guaranteed state-restoring render.
- Reachable sequence: snapshot lease active -> another source calls `terminal.write("X")` directly while `diagnostic === false` -> write is queued in `blockedOutput` -> diagnostic managed render advances physical and renderer frame state -> release replays `X` -> no `doRender` was blocked, so `renderPending` is false and no catch-up is requested.
- Consequence: the physical screen is modified after the renderer's accepted frame, while the next unchanged diff may emit nothing to repair it.
- Deterministic test/PoC: during a deferred snapshot call `tui.terminal.write("X")` without calling `doRender`; complete the diagnostic and release; then request an unchanged managed render. A small VT model should assert physical rows equal `renderer.snapshotDetails().frame`. Current replay can leave `X` after the diagnostic frame with no forced repair.

### A13. Bottom slack is excluded from managed ownership but assumed blank at handoff

- Severity: Medium visible-state mismatch/fallback.
- Exact path: natural area construction in `native-entry-baseline.ts` (`captureNativeEntryBaseline`, approximately lines 37-105); row painting in `screen-frame-diff.ts:7-29`; blank-padding assumption in `native-handoff.ts:48-65`.
- Invariant: every visible row must either be owned/repainted by the managed frame, attested stable history, or explicitly preserved/validated; unowned bottom rows cannot merely be assumed blank.
- Reachable sequence: enter with `naturalBottom < terminalHeight` and stale/nonblank physical rows below the logical native frame -> managed renders affect only `[area.top, area.bottom)` -> bottom slack remains visible/unmanaged -> handoff constructs expected trailing rows as empty strings.
- Consequence: stale bottom bytes remain during managed operation and force a late handoff mismatch/recovery, even though the mismatch was knowable at entry.
- Deterministic test/PoC: use a VT screen model with a short `previousLines` baseline, an origin row above the bottom, and sentinel text in rows below `naturalBottom`. Enter and render an unchanged frame. Assert sentinel rows are either preserved as explicit state or cleared at entry; then assert seamless handoff does not depend on an invented blank value.

### A14. Baseline capture invokes component renders multiple times without a stable transaction

- Severity: Medium fresh-session false classification.
- Exact path: prefix, first-managed-boundary, and baseline-component rendering in `native-entry-baseline.ts:20-116`; initial committed snapshot capture in `managed-renderer.ts` constructor/`captureInitialCommittedSnapshots` (`managed-renderer.ts:35-70,163-170`).
- Invariant: fresh entry must classify committed boundaries from one coherent component-render revision.
- Reachable sequence: a component emits transient render bytes or changes line count across successive `render(width)` calls during entry -> `stableEnd`, logical component bounds, `baselineCommittedComponents`, and committed snapshots are derived from different revisions.
- Consequence: a live/transient component can be classified as baseline committed, or stable-row boundaries can be wrong, producing immediate mutation fallback or a bad physical-origin partition.
- Deterministic test/PoC: create a baseline component that returns one line on its first call and two lines thereafter. Count entry-time calls and assert activation either rejects before patching or derives all boundary/snapshot data from one captured render. Repeat with a nonzero `previousViewportTop` and DSR origin offset to verify row mapping.

### A15. Partial managed writes are not transactionally reversible

- Severity: High terminal integrity.
- Exact path: single composite write in `terminal-render-plan.ts:7-14`; paint/clear bytes in `screen-frame-diff.ts:7-29`; write-failure cancellation and native recovery in `managed-renderer.ts:112-130` and `runtime-patch.ts:123-141`.
- Invariant: after a short/partial terminal write, recovery must reconstruct the physical terminal and scrollback, not only restore logical ledger/frame state.
- Reachable sequence: terminal accepts a prefix of synchronized-output/history/frame bytes, applies destructive cursor movement/line clears or scrolling, then throws -> renderer cancels its prepared ledger transaction and retains its old frame -> runtime invalidates Pi's baseline and native-renders.
- Consequence: a full native visible redraw may repair the viewport but cannot necessarily reverse scrollback displacement or duplicated history already caused by the accepted prefix. Logical cancellation is not physical rollback.
- Deterministic test/PoC: use a VT emulator rather than `writes.push(data.slice(...))`. Inject failure at every byte boundary of a plan containing finalized history plus frame clears; run recovery; compare both visible screen and scrollback against an uninterrupted native reference. Require exact equality, not merely fallback phase or mode-reset bytes.

## Optimization candidates (not adjudicated)

### O1. Every live update re-renders the entire committed transcript

- Severity: High long-session latency candidate.
- Exact path: `ManagedRenderer.assertCommittedSnapshots()` at `my-plugins/codex-viewport/managed-renderer.ts:154-162`; component snapshot capture at `managed-renderer.ts:163-170`.
- Invariant: steady-state render work should scale with changed/live content, not total historical committed components.
- Deterministic benchmark: create `N` committed components with render-call counters and one live component; perform `M` live updates. Assert committed render calls are sublinear in `N*M` or bounded by changed revisions. Current mutation assertion invokes every committed component for every render, yielding at least Theta(`N*M`) component renders.

### O2. Snapshot state capture repeatedly renders the whole layout around asynchronous physical captures

- Severity: Medium long-session latency/side-effect candidate.
- Exact path: `renderedState()` consumers in `my-plugins/codex-viewport/snapshot-state.ts:12-66`; capture order in `execute-snapshot.ts:20-69`.
- Invariant: one diagnostic snapshot should not multiply full-tree component rendering beyond what is required to capture before/after revisions.
- Deterministic benchmark: install render counters on all layout components, take one managed snapshot with no updates, and record calls from `beforeState`, `beforeRenderState`, diagnostic render, and `afterState`. Report call count and wall time for a long transcript; compare with a revision-cached snapshot design. Do not change semantics until the benchmark establishes cost.

### O3. Reentrant render requests are coalesced to one boolean without tracking invalidation epochs

- Severity: Low optimization/correctness-observability candidate.
- Exact path: `my-plugins/codex-viewport/runtime-patch.ts:123-141`.
- Invariant: coalescing should prove that one deferred render observes all invalidations produced during the active render.
- Deterministic stress test: have several component renders synchronously mutate independent state and call `doRender()` multiple times; make `requestRender()` edge-triggered. Assert one deferred render sees the final aggregate state and no subsequent request is necessary. Instrument render epochs rather than only asserting phase.

## Coverage gaps to prioritize

- Existing tests exercise simple reentrant `doRender`, width/height changes, DSR timeout, stop, overlay/image fallback, native render throw, and a throwing managed write, but the adversarial variants above require stateful VT effects, cache mutation before throw, overlapping snapshot/session transitions, multiple pending suffixes, and repeated end events.
- The fake terminal currently records write strings and can throw after a fixed prefix, but it does not model cursor motion, line erasure, scroll regions, synchronized output, scrollback, or stopped-terminal writes. A deterministic VT state model is required for A2-A5, A12, A13, and A15.
- Regression assertions must check ownership (`Object.hasOwn(doRender/stop)`), coordinator phase, ledger finality, Pi baseline fields, physical screen, scrollback, cursor visibility/position, and absence of post-stop/post-replacement writes. Phase-only fallback assertions are insufficient.
