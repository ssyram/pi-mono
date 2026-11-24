## Review

### Scope and evidence status

- The requested repository-root `plan.md` does not exist. The requested repository-root `progress.md` contains only an empty in-progress template. I therefore used the actual bundle plan at `my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/plan.md`.
- This is a read-only challenge. No implementation or test files were changed.
- No tests were run in this review. The deterministic tests below are proposed pinning tests. The existing five tests in `query-terminal-cursor.test.ts` cover ordinary adjacent input, split CPR, abort replay, timeout/late filtering, and write failure, but not competing listeners, a second query during late retention, or synchronous registration.

### Verdict summary

| Finding | Strict verdict | Actual scope |
|---|---|---|
| F09 | **CONFIRMED**, with one production reachability reduction | Earlier-listener competition, duplicate listener observation on replay, and old-filter/new-query competition are allowed by the real Pi dispatcher. The synchronous-registration leak is a real generic-contract bug but is not reachable through Pi's current `addInputListener` implementation. |
| F10 | **CONFIRMED** | Both child executions lack a duration/cancellation bound. A pending capture holds render gating and terminal interception; buffered output has no byte/count ceiling. |
| F11 | **CONFIRMED IN PARTS** | Cursor upper bounds and short-bottom physical attestation are reachable. Previous-only rows are demonstrably not erased by the diff helper, but normal managed growth does not shrink the area; current production reachability of that subcase is not established. |
| F12 | **CONFIRMED AS AN EXPLICIT RESIDUAL BOUNDARY**, not a new contradiction | Pi's API cannot prove delivery, terminal application, atomicity, or rollback. Current design documents already exclude partial physical output, so only an unqualified rollback/native-equivalence claim would be false. |

## F09 — DSR listener competition, replay, registration, and late filtering

**Strict verdict: CONFIRMED for cross-listener exactly-once/isolation.** The narrower claim that Pi's focused component necessarily receives ordinary input twice is not established: replay can make an earlier observer see a fragment twice while the focused component receives it once.

### Attempted disproofs

- **Registration precedes the query write.** This successfully disproves the simple race “the terminal replies after `write` but before listener registration”: `registerInput(...)` runs before `terminal.write("\x1b[6n")` (`query-terminal-cursor.ts:43-79`). It does not isolate the new listener from listeners already in Pi's `Set`.
- **The handler preserves adjacent non-CPR data.** For one listener, complete CPR extraction returns `remaining`, and split trailing prefixes are buffered (`query-terminal-cursor.ts:47-64`). Existing unit tests verify this. It does not prove exactly-once observation across the whole listener chain because replay calls `handleInput` from the beginning.
- **Late filtering is bounded.** Timeout/write failure retains the listener for only `1000 ms` (`query-terminal-cursor.ts:17-42`). This bounds duration, not correctness: the retained listener remains earlier than a subsequently registered query and can consume that query's valid CPR.
- **Synchronous registration might be a production race.** It is not with current official Pi source. `TUI.addInputListener` only inserts into a `Set` and returns a deleting closure; it does not call the handler (`packages/tui/src/tui.ts:649-654`). This subclaim is latent API fragility, not a presently reachable Pi execution.

### Source and official API evidence

- Pi stores input listeners in insertion order and iterates them before focused-component delivery. An earlier listener may return `{ consume: true }` or replace the data observed by later listeners (`packages/tui/src/tui.ts:763-786`, `827-836`). Thus a pre-existing listener can consume or transform CPR before the DSR listener.
- Timeout cleanup replays a buffered prefix with `replayInput?.(replay)` (`query-terminal-cursor.ts:26-33`). Production entry supplies `(data) => patch.internals.handleInput(data)` (`managed-entry.ts:20-27`; similarly `width-reentry.ts:20-27`), restarting the entire official listener chain.
- A handler called synchronously from a generic `registerInput` can settle while `unsubscribe` is still the initial no-op (`query-terminal-cursor.ts:20`, `43-52`). Code then still installs abort handling and sends DSR (`query-terminal-cursor.ts:66-79`). The Round 005 resource proof reports the deterministic observation `{"result":{"row":0,"column":0},"unsubscribed":0,"writes":1}`. This is valid against the function's declared callback contract, but not against Pi's current concrete registration implementation.

### Actual reachability

- **Earlier listener consumes/transforms CPR: reachable.** Any extension or Pi listener registered before managed entry executes first under the official dispatcher.
- **Duplicate observation during replay: reachable.** An earlier listener first observes a trailing `ESC`/`ESC [` fragment. The DSR listener buffers it. On abort or final late-filter cleanup, replay restarts `handleInput`, so that earlier listener observes the same bytes again. Focused delivery is delayed and occurs once.
- **Old late filter consumes query 2's CPR: conditionally reachable.** If a second managed-entry query is started within the first timed-out query's `1000 ms` retention window, insertion order puts the old filter first. A valid CPR resolves neither query 2 nor ordinary input; the old filter removes/consumes it. Lifecycle code exposes managed entry and width re-entry, but this review did not establish an automatic retry inside that exact window. A user/lifecycle-triggered second entry is sufficient.
- **Synchronous-register leak: not reachable through current Pi `addInputListener`.** Retain as defensive-contract coverage only, or narrow `queryTerminalCursor`'s accepted registration contract.
- **CPR-shaped user input:** a retained filter intentionally consumes it. This is a documented ambiguity of in-band DSR, not independently solvable by regex changes.

### Deterministic pinning tests / PoCs

1. **Competition.** Implement a test dispatcher with Pi's exact ordered-loop semantics. Register listener A first and the DSR listener second. Have A return `{ consume: true }` for `\x1b[2;2R`. Assert the query times out. Repeat with A returning transformed data and assert the DSR listener cannot resolve.
2. **Replay observation count.** With fake timers, register counting listener A before the query. Dispatch `\x1b`, let the query timeout and the `1000 ms` late window expire, and assert A observed `\x1b` twice while the focused sink received it once.
3. **Late-filter/query-2 race.** Start query 1, time it out, then start query 2 before advancing `1000 ms`. Dispatch `\x1b[3;4R`. Assert query 2 does not resolve because query 1's retained listener consumed the report. This should fail against current code deterministically.
4. **Synchronous registration contract.** Have `registerInput` invoke the handler with `\x1b[1;1R` before returning an unsubscribe spy. Assert exactly one unsubscribe, zero DSR writes after settlement, and no live timeout/abort registration. Current code instead produces zero real unsubscribes and one write.

### Mitigation and scope reduction

- Provide priority/exclusive ownership for DSR replies in the Pi dispatcher, or a single CPR multiplexer that routes a response to exactly one active query before general listeners.
- Do not replay through the beginning of the listener chain. Resume after the DSR listener, or preserve dispatcher continuation metadata.
- Allow at most one live/retained cursor query; starting query 2 must cancel and remove query 1's late filter before sending DSR.
- After `registerInput` returns, check `settled`; if already settled, call the real unsubscribe and do not install abort/timer state or send DSR.
- Narrow “exactly once” to focused-component delivery if duplicate extension-listener observation is accepted. The current broader input-chain claim is false.

## F10 — unbounded `ps`/`osascript` while snapshot ownership is held

**Strict verdict: CONFIRMED.** This is a liveness and memory-bound defect, not merely slow I/O.

### Attempted disproofs

- `MAX_CAPTURE_BYTES = 64 MiB` bounds captured stdout, not child duration (`terminal-app-capture.ts:5`, `28-33`). A silent child can wait forever.
- `execFile` avoids a shell by default, but this provides neither timeout nor cancellation.
- `executeSnapshot` has `finally { lease.release() }`, but `finally` is reached only after the awaited capture settles (`execute-snapshot.ts:21-50`). A child that never exits prevents release.
- The JavaScript event loop remains alive, so the whole process is not CPU-blocked. Nevertheless, the user-visible renderer is frozen by ownership and write interception; that is the relevant TUI freeze.

### Source and official API evidence

- `resolveControllingTty` invokes `execFile("ps", ...)` with only `encoding` (`resolve-controlling-tty.ts:15-17`).
- `captureTerminalApp` invokes `execFile("osascript", ...)` with `encoding` and `maxBuffer`, but no `timeout`, `killSignal`, or `AbortSignal` (`terminal-app-capture.ts:28-33`). Node's official `child_process.execFile` API makes `timeout` default to `0` (no timeout) and supports `signal` only when supplied: <https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback>.
- The lease is acquired before two awaited physical captures and released afterward (`execute-snapshot.ts:21-50`).
- While active, `RuntimeSnapshotOwner.blockRender()` returns true and remembers only a catch-up request (`runtime-snapshot-owner.ts:19-54`; `runtime-patch.ts:122-124`).
- The lease replaces `terminal.write`; ordinary writes append to an uncapped `string[]` and are replayed only on release (`snapshot-lease.ts:12-25`, `43-52`).

### Actual reachability

- The `/tsnapshot` path acquires a live renderer's lease and then calls physical capture. If no tty is supplied, a hung `ps` blocks before `osascript`; even with a known tty, a hung Terminal.app/AppleScript invocation blocks.
- During the wait, render requests are suppressed and terminal writes are retained. Input/state changes can continue scheduling work, so retained strings can grow without a byte or entry bound.
- `maxBuffer` eventually rejects excessive child stdout, but does nothing for silent hangs and does not bound `blockedOutput`.

### Deterministic pinning tests / PoCs

1. **Child duration.** Launch a helper Node process with `PATH` prefixed by a fake executable named `osascript` whose body is `exec sleep 60`; call `captureTerminalApp("/dev/ttys999")`. The parent enforces a `200 ms` deadline and asserts the helper remains pending, then kills its process group. Repeat with a fake `ps` and `resolveControllingTty()`. This proves current execution has no internal deadline without making the suite wait 60 seconds.
2. **Lease freeze.** Supply `executeSnapshot` a deferred `capturePhysical` promise and a real `RuntimeSnapshotOwner`/fake terminal. After acquisition, request render and call intercepted `terminal.write("x")`; assert no physical write, `blockRender() === true`, and no catch-up render before resolving the deferred capture.
3. **Unbounded retention.** While that deferred capture is pending, write fixed 1 KiB chunks 10,000 times and assert `lease.blockedOutput()` reaches 10 MiB with no failure/backpressure. Resolve capture and verify ordered replay. Use fake data only; no real terminal is required.

### Mitigation and scope reduction

- Give both `ps` and `osascript` explicit short timeouts and a shared `AbortSignal`; terminate the child on snapshot cancellation, shutdown, or lease loss.
- Put a total deadline around the complete before/diagnostic/after transaction, not independent unlimited retries.
- Cap blocked terminal bytes and/or entries. Exceeding the cap must abort capture, release ownership, and perform one native catch-up/recovery rather than silently dropping bytes.
- If preserving arbitrary writes is mandatory, do not hold the renderer lease across external capture. Capture through a bounded side channel or explicitly declare snapshot unavailable when timely physical capture cannot be guaranteed.
- Documentation should say “64 MiB output limit,” not imply bounded capture duration.

## F11 — cursor bounds, shrinking diffs, and short-bottom attestation

**Strict verdict: CONFIRMED IN PARTS.** Cursor and bottom-slack paths can admit a logical frame that is not a proved physical frame. The shrinking-area helper defect is real, but its normal production path is not demonstrated in the current growth-only epoch.

### Attempted disproofs

- Areas themselves are strictly integral and bounded (`inline-viewport-area.ts:9-20`). This does not validate cursor columns.
- `normalizeLines` rejects a rendered line whose visible width exceeds the viewport width (`render-pi-lines.ts:17-24`). A cursor marker immediately after exactly `width` cells leaves marker-free width equal to `width`, so column `width` still passes.
- Handoff compares native lines, cursor, geometry, provenance, and images (`native-handoff.ts:15-54`). However, rows below `frame.area.bottom` are synthesized as empty rather than physically observed.
- Managed growth currently preserves `top` and only increases `bottom` (`live-region-growth.ts:10-16`). That disproves normal shrink reachability through this planner, but not the pure diff helper defect.

### Source and official API evidence

- `createInlineViewportFrame` checks cursor row and `column < 0`, but not finiteness, integrality, or `column < area.width` (`inline-viewport-frame.ts:15-25`).
- Official Pi derives cursor column from `visibleWidth(beforeMarker)` without enforcing `< width` (`packages/tui/src/tui.ts`, `extractCursorPosition`; see also the renderer proof's official-source trace). A marker after a full-width line therefore yields `column === width`.
- DSR parsing accepts any nonnegative safe-integer row/column without comparing terminal dimensions (`cursor-position-report.ts:13-21`). A real conforming terminal should report within its screen, but injected/malformed CPR can enter the model.
- `diffInlineViewport` iterates only `next.rows`; it never clears absolute rows owned only by `previous` (`screen-frame-diff.ts:7-16`).
- Entry computes `naturalBottom` from Pi's logical previous lines, represents unavailable visible rows as `""`, and gives the frame only `visibleRows.slice(area.top, area.bottom)` (`native-entry-baseline.ts:53-75`).
- Handoff constructs `physicalVisible` as stable rows + managed frame + assumed empty strings through terminal height (`native-handoff.ts:25-36`). No physical capture attests those bottom rows.

### Actual reachability

- **Cursor `column === width`: reachable.** A component can emit exactly `width` visible cells before Pi's cursor marker. Official extraction produces `width`, line normalization accepts it, and the viewport frame accepts it. Terminals may clamp, wrap, or retain wrap-pending state, none of which is represented by the logical coordinate. Fractional/`NaN` cursor acceptance is a helper weakness but is not shown reachable from current DSR/native extraction.
- **Shrinking-area residual row: helper reachable, normal renderer path unproven.** Direct callers can pass same-width areas with a smaller `bottom` or raised `top`; the helper emits no erasure for previous-only rows. Current `planLiveRegionGrowth` never does this. Treat it as a contract fix/test, not as a demonstrated normal managed-render release blocker unless a resize/rebase caller is traced to it.
- **Short-bottom false attestation: reachable.** When Pi's logical `previousLines` end above terminal height, entry owns only through `naturalBottom`. Pre-existing physical text below that boundary is neither painted nor captured. Handoff pads those rows with logical empties and can return seamless while the physical sentinel remains.

### Deterministic pinning tests / PoCs

1. **Cursor upper bound.** Create a width-10 frame with `{ row: 0, column: 10 }` and assert construction throws. Current code accepts it. Add an integration fake component producing ten printable cells followed by Pi's cursor marker; assert normalization rejects or forces native redraw instead of accepting column 10.
2. **Shrinking diff.** Seed a small VT emulator with previous area `[top=1,bottom=4)` and rows `A,B,C`. Diff to `[top=1,bottom=3)` and rows `A,B`. Current output is empty, so emulator row 3 remains `C`. Assert either the transition is rejected or output erases row 3.
3. **Raised-top diff.** Previous `[1,4)` rows `A,B,C`; next `[2,4)` rows `B,C`. Current output can again be empty while absolute row 1 remains `A`. Pin the same reject-or-erase rule.
4. **Short-bottom attestation.** Seed a VT emulator row below `naturalBottom` with `SENTINEL`, while fake Pi `previousLines` and native render pad that row as empty. Capture entry, perform no write touching the row, then call `prepareNativeHandoff`. Assert seamless handoff is forbidden while the emulator still contains `SENTINEL`. Current constructed comparison can report seamless.

### Mitigation and scope reduction

- Require finite integer cursor coordinates, `0 <= row < area.height`, and `0 <= column < area.width`. Validate DSR against current terminal rows/columns too.
- Make `diffInlineViewport` require identical `top`, `bottom`, `width`, and terminal geometry. Handle area transitions with a dedicated full paint that explicitly erases `previous \ next` rows. Given current growth behavior, an equal-area guard is the smallest safe change.
- Do not label synthesized bottom empties “physical.” If `frame.area.bottom < terminalHeight`, either physically capture/attest those rows, extend ownership and paint them, or force native full redraw rather than seamless handoff.
- Scope physical-frame equivalence to rows actually owned and painted unless full-screen attestation is added.

## F12 — partial `Terminal.write` and rollback/native equivalence

**Strict verdict: CONFIRMED AS A NON-ROLLBACK BOUNDARY.** It disproves any guarantee extending past the software call boundary. It does not reveal a contradiction in the current design documents, which already state the exclusion.

### Attempted disproofs

- The renderer performs one synchronized-output write and commits logical state only after it returns (`managed-renderer.ts:112-124`). This proves ordering in JavaScript, not terminal atomicity.
- On a synchronous throw, prepared ledger state is cancelled and native recovery starts (`managed-renderer.ts:115-119`; `runtime-patch.ts:197-198`). This proves logical non-acceptance, not that zero prefix bytes reached the stream or terminal.
- DEC synchronized output (`CSI ? 2026 h/l`) can reduce intermediate display, but it is terminal-mode protocol inside the same unacknowledged byte stream. A truncated prefix, unsupported mode, disconnect, or missing closing sequence is not rolled back.
- A native redraw can restore visible cells in favorable cases. It cannot generally remove scrollback duplication, undo scroll-region effects, or prove the terminal received the recovery bytes.

### Source and official API evidence

- Official `Terminal.write(data: string): void` exposes no result (`packages/tui/src/terminal.ts:52-68`). `ProcessTerminal.write` calls `process.stdout.write(data)` and discards its boolean (`packages/tui/src/terminal.ts:454-463`).
- Node's official stream API defines the boolean as buffering/backpressure (`false` means wait for `drain`), not remote/terminal application; callback/error behavior is separate: <https://nodejs.org/api/stream.html#writablewritechunk-encoding-callback>. `process.stdout` can be synchronous or asynchronous depending on destination and platform: <https://nodejs.org/api/process.html#a-note-on-process-io>. Neither API offers terminal transaction rollback.
- Managed state is accepted after the void call returns (`managed-renderer.ts:115-124`). Official Pi's native full render follows the same pattern: write at `packages/tui/src/tui.ts:1311`, then cached cursor/viewport/lines/images/dimensions at `1312-1327`.
- Snapshot replay has the same boundary. It restores the original writer and replays chunks sequentially; if chunk `k` throws, earlier chunks were attempted, chunk `k` has unknown physical extent, and later chunks are not attempted, although owner release still runs (`snapshot-lease.ts:43-52`).
- The design already states the correct limit: `docs/design/research.md:107,115`, `docs/design/known-state.md:81-85`, and `docs/design/proofs/hoare-render-transaction.md:13` explicitly deny rollback/physical atomic-commit confirmation after partial output.

### Actual reachability

- **Unacknowledged success is the ordinary production path.** `process.stdout.write` may return after accepting bytes into Node/OS buffering; the renderer then commits its logical frame without terminal-applied acknowledgment.
- **Partial-before-synchronous-throw is allowed by the `Terminal` interface** and deterministic with a conforming custom/fake implementation. For `ProcessTerminal`, exact synchronous partial-throw behavior is platform/destination dependent; asynchronous stream failure is at least as problematic because the renderer's local `try/catch` cannot classify it.
- **Irreversible terminal effects are reachable** whenever an accepted prefix includes cursor movement, erasure, scrolling, or history bytes before failure/disconnect. Subsequent native redraw may repair the visible grid while leaving scrollback/history observably different.
- Therefore “return control to native rendering” can be promised as an ownership/lifecycle action. “Rollback to, or prove equality with, the pre-write/native physical terminal state” cannot be promised after output begins.

### Deterministic pinning tests / PoCs

1. **Every-byte failure injection.** Feed `buildTerminalRenderPlan(...)` into a minimal VT emulator. For each byte boundary `i`, apply prefix `[0,i)`, throw from fake `Terminal.write`, run current recovery bytes/native redraw, and compare visible grid, cursor/modes, and scrollback with an uninterrupted native-only reference. At least prefixes containing erase/scroll/history operations should remain observably different.
2. **Logical commit boundary.** Fake `write` that throws before applying bytes: assert prepared ledger/frame state is not accepted. Fake `write` that records the full string and returns: assert it is accepted. This pins what the code can prove without pretending either case proves physical application.
3. **Replay strict prefix.** Buffer chunks `A,B,C`; make original writer fully accept `A`, apply a prefix of `B`, then throw. Assert `C` is not attempted, release callback runs, and artifact/event language distinguishes attempted bytes from confirmed bytes. Current code can establish chunk call order but not the applied prefix of `B`.
4. **Asynchronous stream error.** Use a writable destination that accepts `write` and emits an error afterward. Assert renderer logical state has already committed and local `try/catch` does not recover from that event. This demonstrates the gap on a more realistic Node stream path.

### Mitigation and scope reduction

- Keep the explicit residual boundary. State guarantees as: no logical acceptance before `write` returns; no resend after a classified write failure; best-effort native recovery; no rollback or native-equivalent physical-state guarantee once any output may have begun.
- Record output as **attempted**, not emitted/committed. For replay, record successfully returned chunks separately, while still treating the final throwing chunk's physical extent as unknown.
- Observe stream errors and backpressure where the concrete terminal permits it. Awaiting callback/`drain` can improve host-stream ordering and bounded buffering, but must not be described as terminal application or rollback.
- A post-write DSR/sentinel acknowledgment could establish ordering for a surviving responsive terminal, but cannot undo an already applied partial prefix and inherits F09's in-band input hazards.
- If exact native equivalence is a hard requirement, the standard terminal byte-stream interface is insufficient; the requirement must be reduced or the renderer must avoid destructive/history-affecting speculative output.

## Blockers

- The repository-root `plan.md` requested by the task is missing. The bundle-local Round 005 plan was available and used instead.
- F11's shrinking-area production reachability cannot be promoted beyond a helper-contract counterexample from the inspected growth path: `planLiveRegionGrowth` only grows downward. A Judge should not merge that subclaim with the independently reachable cursor and short-bottom defects without this qualification.

## Notes

- F09 and F10 merit corrective implementation plus failing-then-passing tests before a `PROVEN` result.
- F11 should be split into three adjudication records because their reachability differs.
- F12 should be treated as a specification boundary audit: reject unqualified physical rollback/equivalence language, but do not demand an impossible byte-stream transaction as a routine code fix.
