# Round 005 Independent Judge — SCCO + HoarePrompt

## Review

- Correct: all 25 available Round 005 inputs were read: plan, findings pool, four prover reports, four challengers, eight disprove-first reports, and eight counter-challenges. `judge.md`, `scco-report.md`, and `verify.md` were absent from the round directory.
- Correct: the current inventory is **52 non-`*.test.ts` files and 16 `*.test.ts` files**. `test-tui-context.ts` is included in the requested 52 even though it is a test fixture.
- Correct: current tests pass: `node --test --import tsx my-plugins/codex-viewport/*.test.ts` produced **65 passed, 0 failed, 0 skipped** across 16 suites. Passing old tests do not prove the unpinned counterexamples below.
- Blocker: Round 005 is **not converged and not PROVEN**. Confirmed implementation defects remain, several boundary assumptions are partial, and no confirmed finding has a failing-then-passing pinning test.
- Note: line numbers are approximate because the audited tree is uncommitted.

## Judgment vocabulary

- **Q**: requirement/qualification/evidence claim is inconsistent or undecided.
- **D**: architectural or protocol design is insufficient.
- **I**: implementation violates an otherwise usable contract.
- **Non-decisional**: ordinary correctness work follows from the current stated invariants.
- **Human-decision gate**: incompatible product/specification contracts must be selected before implementation.

## F01–F16 adjudication

### F01 — overflow-growth contract

- **Strongest exact claim:** `planLiveRegionGrowth()` grows only `bottom`; once `bottom === terminalHeight`, overflow is cropped and the production call `buildViewportExpansion(area.top, area.top)` can never move `top` upward (`live-region-growth.ts:8-17`, `managed-renderer.ts:94-122`, `viewport-expansion.ts:6-16`). This conflicts with upward-on-overflow design text, while README/known-state text describes cropping.
- **PRE:** valid area `[top,bottom)`, `bottom === terminalHeight`, `overflowRows > 0`. **Post required by upward contract:** `nextTop < top` until capacity is exhausted and displacement is recorded. **Invariant:** no stable row moves without corresponding occupying output.
- **Counterexample:** `{width:80,terminalHeight:10,top:3,bottom:10}`, overflow `2` returns the same `[3,10)` and empty expansion bytes. Reachable from `ManagedRenderer.render()` when pending live rows exceed capacity.
- **Verdict:** **CONFIRMED** as specification/implementation drift; not an unconditional runtime bug until the conflicting crop versus upward-growth contract is resolved.
- **Root/severity/impact:** **Q/D**, Medium. Users get crop-oldest behavior rather than the upward-history behavior claimed by part of the design.
- **Gate:** **Human decision**: select crop-at-bottom or upward displacement. The code cannot satisfy both.
- **Pin:** deterministic `terminal-bottom-overflow-contract.test.ts`: construct the area above and assert the selected contract exactly. PBT: for all valid areas/overflow, assert bounds, growth conservation, and that every `top` decrease equals `displacedStableRows` and has nonempty occupying bytes.
- **Merge:** same root as F15’s unreachable nonzero expansion and F16’s stale growth proof.

### F02 — entry/handoff coordinate and state attestation

- **Strongest exact claim:** the broad origin-arithmetic failure is false: entry explicitly computes and applies `originRow` (`native-entry-baseline.ts:36-75`). The surviving defect is incomplete seamless-handoff attestation: `prepareNativeHandoff()` derives a tail `viewportTop`, pads unobserved trailing physical rows with `""`, and does not compare cursor visibility or terminal modes (`native-handoff.ts:18-53`).
- **PRE:** current Pi baseline geometry, valid DSR, deterministic native render, stable-row attestation. **Post:** either all physical state needed by Pi is equivalent and private fields are seeded, or handoff rejects without mutation. **Invariant:** successful ownership transfer must not create a visible change.
- **Counterexample/rejection:** nonzero-origin algebra commonly rejects through visible-row/cursor mismatch rather than committing unsafe coordinates, so the claimed general coordinate corruption is rejected. A frame whose bytes/cursor match but whose `showHardwareCursor` differs can pass because visibility is unchecked; terminal modes are likewise unattested.
- **Verdict:** **WEAKENED**.
- **Root/severity/impact:** **D/I**, Medium. Conservative false rejection harms liveness; omitted cursor/mode state can cause a visible handoff discrepancy.
- **Gate:** cursor-visibility comparison is **non-decisional**. The larger terminal-mode equivalence set is a **human design gate** tied to supported terminals.
- **Pin:** deterministic nonzero-origin fixtures asserting accept/reject and no mutation on rejection; a cursor-visibility mismatch must reject. PBT: generate coherent `(origin, previousViewportTop, cursor, height)` states and prove `seamless => reconstructed visible rows, cursor, visibility, and declared modes are equal`.
- **Merge:** terminal-state-model root with F08/F11; stale documentation with F16.

### F03 — repeated render observation breaks commit consistency

- **Strongest exact claim:** `prepareCommit()` captures one `component.render(width)` result, `renderManagedContent()` renders the same live components again, terminal bytes use the later result, and `commitPrepared()` checks identity/revision/range/IDs but not byte equality (`managed-renderer.ts:72-167`, `managed-render-content.ts:10-21`, `transcript-ledger.ts:97-173`). Opaque non-tail finality is also heuristic rather than lifecycle-certified (`component-ledger-reconciler.ts:61-93`).
- **PRE:** finalized live item, component identity unchanged, `render(width)` is stateful or impure. **Post required:** committed snapshot equals bytes accepted in the same terminal transaction. **Invariant:** the irreversible frontier advances only for the exact observed bytes written.
- **Counterexample:** a component returns `prepared-A`, then `painted-B`; the frame writes B while ledger acceptance commits the A observation. A later mutation check is too late to undo the accepted transaction.
- **Verdict:** **CONFIRMED**.
- **Root/severity/impact:** **D/I**, High. Scrollback/frontier attribution can diverge from physical output without async interleaving.
- **Gate:** byte-consistent single observation is **non-decisional**. Choosing a positive component-finality API rather than constructor/position heuristics is a **human design gate**.
- **Pin:** deterministic stateful opaque component test asserting written bytes, prepared lines, accepted snapshot, and frontier all refer to one observation. PBT: components with generated render-state machines; acceptance is allowed only when the transaction’s rendered byte vector is identical to the committed vector.
- **Merge:** includes F03’s purity and opaque-finality subclaims; do not split symptoms into separate roots.

### F04 — duplicate/out-of-order run transitions

- **Strongest exact claim:** direct duplicate coordinator calls violate phase/owner consistency: `startRun()` outside idle enters fallback while retaining a patch; a second `finishRun()` during drain sets `idle-native` without releasing that patch; `finishRun()` after shutdown makes `disposed` non-absorbing (`runtime-coordinator.ts:49-54,118-152,216-219`). Disposal resurrection is not established.
- **PRE:** caller invokes duplicate/out-of-order methods. **Post required:** native-labelled phases have no active managed owner and `disposed` is absorbing. **Invariant:** phase and renderer ownership agree.
- **Counterexample/reachability:** direct calls reproduce the invalid states. Official Pi’s normal low-level path emits one awaited `agent_start` and one terminal `agent_end`; overlapping operations are rejected (`packages/agent/src/agent-loop.ts:108-115,195-198,246-255,269-273`; `packages/agent/src/agent.ts:430-524`). Thus duplicate-event production reachability is not established. A successor run while asynchronous handoff remains draining is still an unresolved legitimate ordering.
- **Verdict:** **WEAKENED**.
- **Root/severity/impact:** **D/I**, Medium as robustness; potentially High if successor-run overlap is demonstrated.
- **Gate:** idempotent/closed transitions are **non-decisional**.
- **Pin:** deterministic direct duplicate `startRun`, duplicate `finishRun`, and post-shutdown calls; additionally delay drain completion, deliver official ordered `end -> start`, and assert one owner, absorbing disposal, and no native phase with patched `doRender`. Model/PBT: arbitrary legal and illegal event sequences against a reference FSM.
- **Merge:** lifecycle closure root with F05/F13; official same-coordinator session replacement is addressed separately under F14.

### F05 — noncanonical exception recovery

- **Strongest exact claim:** ordinary fallback does use `recoverNativeRenderer()`, but three exception transactions do not: width-redraw failure, native-commit failure after handoff primes Pi fields, and dirty recapture catch-up failure (`runtime-patch.ts:142-191`, `native-commit.ts:13-27`, `runtime-coordinator.ts:169-198`, `runtime-failure.ts:13-17`).
- **PRE:** saved native render or catch-up throws, possibly after terminal/cache mutation. **Post required:** ownership is restored and Pi’s baseline is invalidated/repainted or the uncertain state is explicitly fenced. **Invariant:** no subsequent native render trusts a partially mutated baseline.
- **Counterexample:** `prepareNativeHandoff()` mutates private Pi baseline; saved `doRender()` writes a prefix then throws. The failure disables/restores the patch and rethrows, so outer recovery no longer runs and the primed baseline remains trusted.
- **Verdict:** **CONFIRMED**, narrowed to the three exception branches.
- **Root/severity/impact:** **D/I**, High. Subsequent redraw can diff from a false baseline after a destructive or partial native write.
- **Gate:** **Non-decisional** unified failure fencing/recovery. No rollback of already delivered bytes is required.
- **Pin:** three deterministic fault-injection tests: width redraw throws after prefix; native commit throws after baseline priming; dirty gate catch-up throws. Assert method ownership, baseline invalidation, recovery attempt, phase, and explicit unknown-prefix boundary.
- **Merge:** lifecycle/recovery root with F04/F13; partial physical write itself remains F12’s boundary.

### F06 — snapshot lease is not lifecycle-fenced

- **Strongest exact claim:** a pending lease is neither stored nor canceled/awaited by `capture`, `finishRun`, or `shutdown`; release unconditionally replays buffered writes without generation, TUI identity, phase, or `stopped` checks (`execute-snapshot.ts:21-56`, `snapshot-lease.ts:12-52`, `runtime-coordinator.ts:22-47,116-190`).
- **PRE:** physical capture remains pending while TUI stop/shutdown occurs. **Post required:** old-owner bytes cannot be replayed after stop or into a later owner epoch. **Invariant:** lease output belongs to exactly one live renderer/session epoch.
- **Counterexample:** acquire lease, queue stop/reset or other direct writes, call shutdown/TUI stop, then settle capture; release replays queued bytes through process-global stdout after stop. Official `TUI.stop()` sets `stopped`, emits reset/cursor bytes, then stops the terminal (`packages/tui/src/tui.ts:687-711`), and interactive shutdown contains both disposal/stop orderings (`interactive-mode.ts:3494-3519`). The pre-`try` startup-leak reproduction is mechanically valid under injected throwing dependencies but not established for default production `now()`/journal ordering.
- **Verdict:** **CONFIRMED**, narrowed to lifecycle fencing and stale replay.
- **Root/severity/impact:** **D/I**, High. Cross-epoch terminal corruption and stale output after stop.
- **Gate:** **Non-decisional** lease ownership/cancellation/fencing; exact policy for dropping versus replaying stop-time bytes is a small design choice but must obey epoch ownership.
- **Pin:** deferred capture under each official stop/shutdown ordering; queue sentinel writes, replace/stop owner, settle capture, and assert no stale replay and exactly one release. PBT: event sequences over acquire/write/render/stop/replace/release preserve epoch-tagged output order.
- **Merge:** resource/liveness root with F10; do not merge artifact publication F07.

### F07 — snapshot publication is symlink-following and non-atomic

- **Strongest exact claim:** artifact and `latest.json` writes use final path `writeFile` followed by `chmod`; members publish concurrently; there is no exclusive descriptor open, symlink rejection, temp+rename, file sync, or parent-directory sync (`snapshot-artifacts.ts:9-64`).
- **PRE:** same-account preexisting symlink or crash/fault during publication. **Post required:** writes remain under the snapshot root and success never exposes a torn generation as current. **Invariant:** artifact path integrity and publication atomicity.
- **Counterexample:** precreate an artifact or `latest.json` symlink to a victim; `secureWrite()` follows it, replaces content, and chmods the target. Fault after one member leaves a partial directory; interruption during direct `latest.json` overwrite can expose torn current metadata.
- **Verdict:** **CONFIRMED**.
- **Root/severity/impact:** **I** (with durability contract **Q**), High integrity/confidentiality for same-account paths; High crash-consistency for diagnostics advertised as durable.
- **Gate:** secure exclusive/temp publication is **non-decisional**. Required durability level (`rename` only versus synced file+directory) is a **human contract gate**.
- **Pin:** deterministic artifact and `latest.json` symlink tests; injected failure after every filesystem operation; concurrent reader sees only old or complete-new manifest. PBT: generated fault index/order proves no out-of-root write and no `latest` reference to an incomplete generation.
- **Merge:** durability wording with F16.

### F08 — admitted control grammar exceeds terminal proof

- **Strongest exact claim:** Kitty and iTerm image markers are rejected, but normalized component lines can retain general CSI cursor/erase/mode controls, OSC, DCS/APC/PM/SOS, and Sixel; environment-name detection does not attest the required terminal capabilities (`render-pi-lines.ts:11-36`, `kitty-image-block.ts:1-3`, `detect-supported-terminal.ts:3-8`). Those bytes reach managed `Terminal.write()` (`managed-renderer.ts:106-124`).
- **PRE:** a component emits visible-width-valid text containing an unmodeled control. **Post required:** managed bytes are row-local under a documented accepted grammar. **Invariant:** renderer diff math is the sole authority for cursor/cell movement.
- **Counterexample:** `"\x1b[1Atext"` or Sixel passes image detection/visible-width checks and can mutate a different row or graphics plane. `TERM=vt100` or `TMUX` is accepted without capability probing.
- **Verdict:** **CONFIRMED**, narrowed to controls other than the two detected image protocols.
- **Root/severity/impact:** **D/I**, High. Cursor escape, stale rows, graphics persistence, or terminal-mode leakage invalidates the frame proof.
- **Gate:** defining the accepted grammar/support matrix is a **human design gate**; enforcing it is non-decisional afterward.
- **Pin:** table tests for every CSI/OSC/DCS/APC/PM/SOS/Sixel class and allowed SGR/reset controls. PBT: generate escape-token streams and prove accepted lines are row-local in a VT model; unsupported capability environments must fail preflight.
- **Merge:** terminal-model root with F02/F11.

### F09 — DSR input ownership is not exactly once

- **Strongest exact claim:** Pi dispatches listeners in insertion order and permits consumption/data replacement; an earlier listener can consume CPR, buffered prefixes can be observed then replayed to earlier listeners, and a timed-out filter retained for 1000 ms can consume a later query’s CPR (`query-terminal-cursor.ts:17-80`, `packages/tui/src/tui.ts:649-654,763-836`).
- **PRE:** competing earlier listener, incomplete prefix, timeout, or overlapping query. **Post required:** one query consumes one CPR while every non-CPR input fragment is delivered exactly once in order. **Invariant:** query filtering neither loses nor duplicates user input.
- **Counterexample:** earlier listener sees an incomplete fragment; query buffers it; delayed cleanup replays it through `handleInput`, so the earlier listener observes it twice. A stale retained query can consume the next query’s report.
- **Verdict:** **CONFIRMED**, narrowed. The synchronous-registration unsubscribe leak is rejected for current Pi because `addInputListener` itself does not invoke the callback during registration.
- **Root/severity/impact:** **D/I**, Medium. Lost CPR, delayed entry, or duplicate/lost terminal input.
- **Gate:** **Non-decisional** centralized query serialization/ownership and exact replay semantics.
- **Pin:** faithful insertion-ordered multi-listener dispatcher tests for earlier consumption, incomplete-prefix timeout replay, and old/new query overlap. PBT: arbitrary chunking/interleaving proves non-CPR byte conservation and at-most-one CPR owner.
- **Merge:** standalone input-boundary root.

### F10 — unbounded snapshot child-process duration

- **Strongest exact claim:** `ps` and `osascript` have neither timeout nor abort/kill policy; while physical capture is pending, the snapshot lease blocks renders and accumulates an uncapped `blockedOutput: string[]` (`resolve-controlling-tty.ts:14-17`, `terminal-app-capture.ts:28-36`, `snapshot-lease.ts:12-25`). `maxBuffer` bounds captured stdout, not blocked terminal output or duration.
- **PRE:** child remains silent and alive. **Post required:** capture settles within a deadline and releases all ownership/resources. **Invariant:** external process delay cannot indefinitely own renderer output.
- **Counterexample:** PATH shim `ps` or `osascript` sleeps forever; snapshot never reaches `finally`, queued terminal chunks grow without bound.
- **Verdict:** **CONFIRMED**.
- **Root/severity/impact:** **I**, High liveness/resource exhaustion.
- **Gate:** **Non-decisional** deadline, abort propagation, child termination, and bounded queue.
- **Pin:** separate silent `ps` and `osascript` shims; assert deadline rejection, child death, lease release, and bounded queued bytes. PBT: generated delays/output rates remain within configured time/memory bounds.
- **Merge:** snapshot-resource root with F06.

### F11 — frame bounds and relinquished-row proof

- **Strongest exact claim:** production can accept `cursor.column === width` because only `column < 0` is rejected (`inline-viewport-frame.ts:15-25`, `render-pi-lines.ts:24-34`); `diffInlineViewport()` does not erase rows present only in the previous area (`screen-frame-diff.ts:7-16`). The claimed stale short-bottom handoff row is not yet reachable under proved production invariants.
- **PRE:** width-filled cursor output, or helper called with shrinking/raised area. **Post required:** cursor is within `[0,width-1]`; every relinquished previous row is explicitly reconciled. **Invariant:** no old visible cell remains outside the next modeled frame.
- **Counterexample:** width 10 and cursor column 10 yields CUP column 11. Previous `[top=1,bottom=4)` rows A/B/C to next `[1,3)` A/B emits no erase for C. Normal same-height rendering currently grows rather than shrinks bottom, so the latter is a helper-contract defect without demonstrated ordinary corruption. Fractional/NaN production coordinates and a stale sentinel below short `naturalBottom` are unestablished.
- **Verdict:** **WEAKENED**: cursor defect confirmed; diff helper contract confirmed; short-bottom unsafe handoff disputed.
- **Root/severity/impact:** **I/D**, Medium visual/cursor risk; potentially High only if stale-tail reachability is demonstrated.
- **Gate:** cursor bound and total-area diff are **non-decisional**. Physical trailing-row precondition belongs to F02/F08’s terminal model.
- **Pin:** cursor columns `width-1` and `width`; previous-only top and bottom row erasure in a VT emulator; production height-rebase/growth transition corpus. PBT: arbitrary valid previous/next areas must leave emulator cells equal to next frame or explicitly outside an attested ownership set.
- **Merge:** terminal/frame-model root with F02/F08.

### F12 — partial terminal writes

- **Strongest exact claim:** `Terminal.write(data): void` and `ProcessTerminal.write()` provide no applied-byte/terminal-commit acknowledgement; a throw may follow an unknown delivered prefix (`packages/tui/src/terminal.ts:52-72,454-470`, `managed-renderer.ts:112-124`). Logical preparation can be canceled, but physical rollback is impossible to establish.
- **PRE:** writer applies prefix `0..k` then throws. **Post actually supportable:** logical frontier does not advance; physical state is explicitly unknown after the attempted prefix; later recovery is best effort. **Invariant:** never claim rollback or atomic physical commit from a void write.
- **Counterexample/reason rejected:** prefix-then-throw demonstrates the boundary, not a code defect demanding impossible rollback. Current proof/known-state text expressly excludes rollback and physical atomic-commit confirmation. Replay similarly guarantees only attempted chunk order; the failing chunk may be partial and later chunks are unattempted.
- **Verdict:** **REJECTED as an actionable rollback finding; CONFIRMED as an explicit residual boundary**.
- **Root/severity/impact:** boundary at **Q/external**. Runtime impact can be severe visual corruption, but it is not eliminable under the API.
- **Gate:** no human decision is needed to preserve the boundary. Recovery policy improvements are non-decisional but must not claim rollback.
- **Pin:** configurable terminal fails after every byte offset `k`; assert no logical acceptance, exact attempted-prefix classification, best-effort recovery, and no later replay chunks after a failing chunk. This is a characterization/PBT boundary test, not a rollback acceptance test.
- **Merge:** do not merge into F05; F05 is missing recovery after this boundary, while F12 defines the irreducible boundary.

### F13 — run-scoped permanent native fallback

- **Strongest exact claim:** temporary overlay, tool-expansion change, image, or insufficient-height preflight causes `native-fallback`, and the current run has no generic transition from `active-native-fallback` back to managed (`managed-renderer.ts:149-154`, `runtime-patch.ts:193-197`, `runtime-coordinator.ts:185-213`). A later run can re-enter.
- **PRE:** transient rejection during an active run, then condition clears. **Post desired by managed-availability claim:** supported conditions eventually recapture managed ownership. **Invariant:** transient state must not permanently disable the declared mode unless fail-open-for-run is the contract.
- **Counterexample:** show overlay for one managed render, remove it, request another render; current run remains native fallback. `finishRun()` then later `startRun()` disproves extension-lifetime permanence.
- **Verdict:** **CONFIRMED**, narrowed to current run.
- **Root/severity/impact:** **Q/D**, Medium availability/optimization; native correctness is preferred over unsafe recapture.
- **Gate:** **Human decision**: intentional fail-open for the rest of a run versus same-run recapture.
- **Pin:** transient overlay/tool/image/fit tests assert the selected recovery contract through clear, next render, finish, and next run. Model/PBT: temporary rejection toggles never create two owners and eventual managed availability matches the chosen policy.
- **Merge:** lifecycle design with F04/F05.

### F14 — repeated session capture suppresses prior recovery failure

- **Strongest exact claim:** direct repeated `RuntimeCoordinator.capture()` catches prior patch return/recovery/disposal errors and binds a replacement context without retaining an uncertainty bit (`runtime-coordinator.ts:22-46`). The named official reload/new/resume/fork paths, however, recreate the extension runner/coordinator before the replacement `session_start`, so two captures on one coordinator are not established (`agent-session.ts:2530-2605`; `agent-session-runtime.ts:195-348`).
- **PRE:** same coordinator receives a second capture and prior recovery throws. **Post required:** no new managed epoch starts over unattested physical state. **Invariant:** recovery uncertainty crosses context replacement.
- **Counterexample/reachability:** direct same-instance call is real and can later activate managed rendering. Official tested replacement ordering is shutdown old instance, create new extension runtime, then start; that does not reuse the coordinator. Thus the claimed official path is rejected on current source.
- **Verdict:** **WEAKENED** to function/API robustness; official production reachability **DISPUTED and not established**.
- **Root/severity/impact:** **I**, Low under current official lifecycle, High if extension hosts may reuse the instance.
- **Gate:** preserving/rethrowing recovery uncertainty is **non-decisional** hardening; expanding supported host lifecycle would be a human scope decision.
- **Pin:** same-instance double capture with injected recovery failure must fence future entry; separate official extension instances must demonstrate no shared coordinator. Add an official lifecycle contract test that fails if a future path emits two `session_start`s to one runner.
- **Merge:** not merged with F06: F06 is reachable across stop on one live lease even without coordinator reuse.

### F15 — duplicated/dead transaction machinery

- **Strongest exact claim:** blanket dead-machinery is false. Prepared commits, stable-row attestation, and native commit are production-consumed. Two repository-local concerns survive: nonzero viewport expansion has no production caller because equal tops are always passed, and `StableScreenRows.previewAppend()/accept()/revision` have no call sites (`viewport-expansion.ts:6-16`, `live-region-growth.ts:9-16`, `stable-screen-rows.ts:1-34`).
- **PRE:** current call graph. **Post for Concise:** every retained state/protocol contributes to a selected invariant. **Invariant:** no parallel transaction abstraction without a consumer or proof purpose.
- **Counterexample/rejection:** `managed-renderer.ts`, `transcript-ledger.ts`, `native-handoff.ts`, and `native-commit.ts` actively consume the other named mechanisms, rejecting the blanket claim. Static call graph confirms the two unused surfaces.
- **Verdict:** **WEAKENED**.
- **Root/severity/impact:** **D/Q**, Low direct runtime impact; Medium proof and maintenance cost.
- **Gate:** expansion is gated by F01’s contract decision. Removing or wiring the apparently intentional stable preview API is a **human decision**.
- **Pin:** architecture call-graph test/lint requiring every exported state-transition API to have a production consumer; after F01 decision, deterministic overflow test must either exercise nonzero expansion or assert the module is absent. No behavioral test should pretend unused code is live.
- **Merge:** F01/F16 growth root.

### F16 — documentation and evidence overclaim

- **Strongest exact claim:** current docs/evidence disagree with code: `native-commit-gate` is omitted from detailed state inventory; upward-growth and stable-preview claims conflict with call paths; allowlisted terminals are described elsewhere as unfinished; artifact durability exceeds direct-write behavior; hard-death/IME proof is absent; stale test/source counts exist. Code inventory is 52+16, not the challenged 50+17 (`runtime-phase.ts:1-9`, `docs/design/detailed-design.md:45-49`, `docs/design/known-state.md:79-85`, `README.md:52-61`).
- **PRE:** docs are used as proof authority. **Post required:** each public/design claim maps to current implementation and executable evidence, with explicit residual boundaries. **Invariant:** no overall PROVEN label while any traced path is partial or contradicted.
- **Counterexample:** active coordinator uses `native-commit-gate`; docs omit it. Tests currently report 65/16, while stale audit evidence says 59/12. No SIGKILL/restart or Apple Terminal Chinese IME integration evidence exists.
- **Verdict:** **CONFIRMED**.
- **Root/severity/impact:** **Q**, Medium assurance/release risk; it can cause false safety claims rather than direct runtime corruption.
- **Gate:** factual count/phase/evidence corrections are **non-decisional**. Growth, terminal support, fallback, and durability wording depend on the human gates above.
- **Pin:** documentation consistency checker compares phase literals, inventory, support matrix, and generated test summary against code; evidence manifest requires named executable artifacts for hard-death/IME claims or marks them explicitly unverified.
- **Merge:** documentation faces of F01/F07/F08/F15; keep one documentation root in the final queue.

## Proof coverage judgment — all 52 non-test files

No module marked PARTIAL or DISPROVEN contributes an unconditional end-to-end proof. “PROVEN” below is local to the stated function contract.

| # | Module | Judgment by function/path | Untraced or failed obligation |
|---:|---|---|---|
| 1 | `begin-width-recapture.ts` | `beginWidthRecapture` **PARTIAL** | thrown `onActivated`/`onFailed` callbacks and rejected continuation are not fenced |
| 2 | `codex-viewport.ts` | wiring/`registerToolCalls` **PARTIAL** | host event cardinality, handler completion, notification/persistence failure semantics |
| 3 | `component-ledger-reconciler.ts` | reset/tool bookkeeping **PROVEN**; `initialize`, `beginAssistant`, `completeAssistant`, `firstManagedComponent`, `isStatic` **PARTIAL**; `reconcile` **DISPROVEN** | constructor/shape ABI, first-unattached assistant, opaque non-tail finality |
| 4 | `component-shapes.ts` | `recordOf` **PROVEN**; shape predicates **PARTIAL** | structural collisions with unrelated components |
| 5 | `cursor-placement.ts` | `buildCursorPlacement` **PARTIAL** | relies on invalid column admitted by frame; terminal cursor-mode semantics |
| 6 | `cursor-position-report.ts` | `extractCursorPositionReport` **PROVEN** for its grammar | competing reports/listener ownership is outside this parser |
| 7 | `detect-supported-terminal.ts` | `detectSupportedTerminal` **DISPROVEN** as capability attestation | env spoofing, multiplexer/terminal feature matrix |
| 8 | `execute-snapshot.ts` | error capture core **PARTIAL**; `executeSnapshot` **DISPROVEN** | pre-finally acquisition gap under injected throws, stale lease lifecycle, swallowed publication error |
| 9 | `index.ts` | re-export **PROVEN** | none |
| 10 | `inline-viewport-area.ts` | `createInlineViewportArea` **PROVEN** | none within numeric contract |
| 11 | `inline-viewport-frame.ts` | `createInlineViewportFrame` **DISPROVEN** | column upper bound; finite/integer validation remains partial though production nonfinite reachability is unshown |
| 12 | `invalidate-native-baseline.ts` | `invalidateNativeBaseline` **PROVEN** logically | physical repaint remains caller obligation |
| 13 | `kitty-image-block.ts` | two marker checks **PROVEN**; general image exclusion **DISPROVEN** | Sixel and other graphics/control protocols |
| 14 | `live-region-growth.ts` | downward arithmetic **PROVEN**; specified overflow behavior **DISPROVEN** | upward contract undecided; nonzero expansion unreachable |
| 15 | `managed-entry.ts` | cancellation/currentness **PARTIAL** | DSR ownership, render purity, private ABI, activation callback behavior |
| 16 | `managed-height-rebase.ts` | `rebaseManagedHeight` **PROVEN** | composition with physical relinquished rows is untraced |
| 17 | `managed-render-content.ts` | layout concatenation **PROVEN**; observational contract **PARTIAL** | repeated impure component renders |
| 18 | `managed-renderer.ts` | constructor/snapshot/prepare/cancel **PARTIAL**; `render`, `acceptPrepared` transaction **DISPROVEN** | repeated-render mismatch, growth contract, ANSI, recovery and partial writes |
| 19 | `native-commit.ts` | reject-before-native path **PROVEN**; `commitNatively` transaction **PARTIAL/DISPROVEN** | handoff mutates baseline before saved render can partially fail |
| 20 | `native-entry-baseline.ts` | origin algebra **PROVEN under coherent baseline**; whole capture **PARTIAL** | repeated render, stable-row provenance, private fields |
| 21 | `native-handoff.ts` | checks-before-field-assignment **PROVEN**; seamless equivalence **PARTIAL** | cursor visibility, terminal modes, unobserved trailing rows |
| 22 | `native-snapshot-target.ts` | owner rejection/catch-up core **PARTIAL** | `Reflect.deleteProperty(false)`, callback throws, lifecycle identity |
| 23 | `pi-layout.ts` | `probePiLayout` **PROVEN for current nine-child ABI** | semantic identity of structurally matching children remains partial |
| 24 | `query-terminal-cursor.ts` | CPR extraction use **PARTIAL**; end-to-end query **DISPROVEN** | listener competition, replay duplication, retained late filter |
| 25 | `recover-native-renderer.ts` | best-effort attempt ordering **PROVEN**; recovery guarantee **PARTIAL** | reset+render dual failure and unknown physical prefix |
| 26 | `render-pi-lines.ts` | concatenation **PROVEN**; normalization/viewport extraction **DISPROVEN** | admitted controls, cursor bound, render purity |
| 27 | `resolve-controlling-tty.ts` | `parseControllingTty` **PROVEN**; `resolveControllingTty` **DISPROVEN** for liveness | no timeout/abort/child cleanup |
| 28 | `restore-runtime-patch-methods.ts` | identity guards **PROVEN**; restoration **PARTIAL** | ignored failed property deletion/descriptor mutation |
| 29 | `runtime-coordinator.ts` | normal generation/current guards **PROVEN**; transition system **DISPROVEN** | duplicate/out-of-order closure, discarded recovery errors, lease ownership, recapture failures |
| 30 | `runtime-failure.ts` | `failureText`, guarded notify **PROVEN**; `returnWidthGateSafely` **DISPROVEN** as recovery | catch-up exception is erased |
| 31 | `runtime-patch-contract.ts` | declarations **PROVEN** as inventory | contract omits epoch/cancellation and physical-write boundary semantics |
| 32 | `runtime-patch-preflight.ts` | exclusive own-property checks **PARTIAL** | environment capability, private ABI, semantic layout identity |
| 33 | `runtime-patch.ts` | install/normal ownership paths **PARTIAL**; exception transaction **DISPROVEN** | width/native-commit/gate failures, descriptor restoration, snapshot callbacks |
| 34 | `runtime-phase.ts` | eight-literal type **PROVEN** | system transition closure is disproven in coordinator |
| 35 | `runtime-snapshot-owner.ts` | single active lease **PROVEN** locally; release/catch-up **PARTIAL** | epoch/stopped identity, throwing callbacks |
| 36 | `screen-frame-diff.ts` | `moveTo`, full paint **PROVEN** under terminal grammar; `diffInlineViewport` **DISPROVEN** | previous-only rows, physical control semantics |
| 37 | `select-snapshot-target.ts` | phase mapping **PROVEN** | safety relies on truthful coordinator phase |
| 38 | `snapshot-artifacts.ts` | naming/mode happy path **PROVEN**; secure/durable publication **DISPROVEN** | symlinks, exclusivity, atomicity, sync, cleanup |
| 39 | `snapshot-journal.ts` | begin/record/finish state machine **PROVEN** locally | wall-clock failure/injected active-journal composition remains outside local proof |
| 40 | `snapshot-lease.ts` | ordered attempted replay and owner `finally` **PROVEN**; lifecycle-safe release **DISPROVEN** | stale replay, unbounded buffering, unsubscribe/owner throw, partial current chunk |
| 41 | `snapshot-state.ts` | field copying **PROVEN**; capture observational purity **PARTIAL** | component render side effects/exceptions and coherent single revision |
| 42 | `snapshot-types.ts` | declarations **PROVEN** | no runtime validation for internal artifact object |
| 43 | `stable-screen-rows.ts` | constructor/rows/accept **PARTIAL** | unused preview/revision protocol; readonly is not runtime immutability; consumer proof absent |
| 44 | `terminal-app-capture.ts` | payload guard/parser **PROVEN**; `captureTerminalApp` **DISPROVEN** for liveness | no timeout/abort/kill; external Terminal.app behavior |
| 45 | `terminal-render-plan.ts` | byte concatenation **PROVEN**; atomic terminal transaction **PARTIAL** | synchronized-output support and partial-write boundary |
| 46 | `test-tui-context.ts` | fixture mechanics **PARTIAL** | not production; lacks VT cell model, multiple listeners, modes/images/backpressure |
| 47 | `transcript-ledger.ts` | source order/revision/range guards **PROVEN**; prepare/commit byte contract **PARTIAL** | prepared lines not compared, mutable components, heuristic finality supplied externally |
| 48 | `tui-internals.ts` | structural probe **PARTIAL** | private ABI semantics/descriptors and future Pi versions |
| 49 | `tui-probe.ts` | `getTui` **PARTIAL** | assumes synchronous widget factory and safe temporary mutation |
| 50 | `viewport-expansion.ts` | arithmetic/byte construction **PARTIAL** | nonzero production path absent; VT/scrollback displacement not emulator-proved |
| 51 | `volatile-region.ts` | `volatileLiveCapacity`, `renderVolatileRegion` **PROVEN** | product choice to crop versus fallback is specified by caller, not proved here |
| 52 | `width-reentry.ts` | currentness/cancellation **PARTIAL** | DSR/input ownership, repeated render, observer mutation, activation callback |

### Globally untraced areas

1. A stateful VT cell/scrollback model for every emitted CSI/control path.
2. Terminal capability matrices across Apple Terminal, iTerm2, Kitty, WezTerm, tmux, and accepted TERM fallbacks.
3. Exact physical cells, cursor visibility, scroll region, sync-update mode, and graphics state at ownership transfer.
4. Partial writes at every byte/chunk boundary; only the logical boundary is stated.
5. Multiple Pi input listeners, natural timeout chunking, and old/new DSR overlap in the real dispatcher.
6. Snapshot capture interleaved with both official TUI stop orderings, shutdown, and later terminal ownership.
7. Hung/aborted `ps` and `osascript`, child cleanup, and bounded blocked output.
8. Artifact crash/fault/symlink/concurrent-reader publication behavior and filesystem sync semantics.
9. Stateful/throwing/reentrant component rendering across entry, commit, handoff, and snapshot capture.
10. Legitimate ordered successor run while prior run remains `draining-handoff`.
11. Descriptor mutation and failed `Reflect.deleteProperty` on private method ownership.
12. SIGKILL/restart recovery, Apple Terminal Chinese IME/candidate-window behavior, and third-party direct stdout writers.
13. No failing-then-passing tests exist for the confirmed Round 005 findings.

## SCCO judgment

- **Sound: NOT DONE.** F03, F05–F10, and the confirmed portion of F11 have concrete invariant violations. F12 is correctly retained as an explicit physical boundary rather than mislabeled as rollback-capable.
- **Complete: NOT DONE.** All 52 files are now inventoried, but many functions remain PARTIAL; the globally untraced areas above prevent completeness. Official normal duplicate-run reachability and same-coordinator session replacement were narrowed rather than assumed.
- **Concise: NOT DONE.** The nonzero viewport-expansion path and `StableScreenRows` preview/revision API lack production consumers; recovery/recapture mechanisms remain split. Most prepared/native-commit machinery is live and must not be deleted as “dead.”
- **Optimization: PARTIAL.** The core architecture—one managed owner, native finalized-prefix commit, and native idle renderer—is a plausible minimal architecture. It is not optimized/proved while it rerenders components repeatedly, retains unused protocol surfaces, and has multiple inconsistent failure-return paths.
- **Convergence: FAILED.** Confirmed non-decisional work remains unfixed, decisional contracts remain unresolved, pinning tests are absent, and no clean-room post-fix re-review exists.

## Final reduced root-cause queue

1. **R1 — Render observation/finality protocol (F03):** make one immutable byte observation authoritative for paint and frontier acceptance; replace heuristic finality with positive evidence.
2. **R2 — Lifecycle and recovery closure (F04/F05/F13):** close the FSM, make disposal absorbing, unify all exceptional returns, and decide current-run recapture policy.
3. **R3 — Snapshot epoch/resource ownership (F06/F10):** coordinator-owned cancellation/deadline, epoch-fenced replay, bounded buffering, and child cleanup.
4. **R4 — Secure crash-consistent artifacts (F07/F16):** no-follow/exclusive temp publication, atomic current pointer, selected sync contract, fault tests, corrected claims.
5. **R5 — Terminal grammar/frame attestation (F02/F08/F11):** accepted-control grammar, capability contract, complete cursor/frame/mode handoff predicates, total relinquished-row diff.
6. **R6 — DSR input transaction (F09):** serialized ownership and exactly-once non-CPR replay against Pi’s real listener dispatcher.
7. **R7 — Overflow contract and concise call graph (F01/F15/F16):** choose crop versus upward displacement, then remove or exercise the corresponding machinery and align docs.
8. **R8 — Residual physical-write boundary (F12):** characterization and recovery tests only; never claim rollback or physical atomic acknowledgement.
9. **R9 — Evidence truthfulness (F16):** generated inventories, current phase diagram, explicit unverified hard-death/IME/terminal claims.

## Rejected-findings log

- F02 general origin omission/unsafe coordinate commit: rejected; origin is explicitly incorporated and mismatches generally reject.
- F04 delayed activation resurrects a disposed patch: rejected by generation/phase/identity/abort guards.
- F04 ordinary official duplicate start/end events: not established; retain only direct API and unresolved successor-during-drain cases.
- F05 blanket “fallback never recovers”: rejected; ordinary managed fallback and terminal-write failure use canonical recovery.
- F06 default-production pre-journal startup leak: not established; retain lifecycle-unfenced lease/replay.
- F08 Kitty and iTerm2 image bypass: rejected; those two markers are explicitly detected.
- F09 synchronous-registration unsubscribe leak in current Pi: rejected; current `addInputListener` does not synchronously call the handler.
- F11 fractional/NaN cursor as a production defect: rejected absent a producer. Normal-path shrink corruption and stale short-bottom sentinel remain unproven; helper/precondition gaps remain.
- F12 required rollback/physical atomic commit: rejected as impossible and explicitly outside the contract.
- F13 extension-lifetime permanent fallback: rejected; fallback is current-run scoped.
- F14 official reload/new/resume/fork reuses one coordinator: rejected on traced current lifecycle; each path recreates the extension runtime.
- F15 prepared commits, stable-row data, and native commit are blanket dead machinery: rejected; they have production consumers and passing tests.
- F16 `50 production + 17 tests`: rejected; current count is `52 non-test + 16 test`.

## Decisional queue

1. Choose terminal-bottom overflow semantics: crop-oldest versus upward displacement/history growth.
2. Choose whether transient native fallback is intentionally rest-of-run or must automatically recapture managed mode.
3. Define the supported terminal/capability matrix and accepted ANSI/control grammar.
4. Define snapshot durability: process-atomic rename only, or crash-durable file and directory synchronization.
5. Define positive component identity/finality evidence required before irreversible native commit.
6. Decide whether unused `StableScreenRows` preview/revision API is intentional future functionality or should be removed after the overflow decision.

## Required next round

1. Resolve the six human gates and update the normative design before implementation.
2. Fix all non-decisional roots without claiming rollback across partial terminal writes.
3. Add each deterministic/PBT pin above; demonstrate failing-before and passing-after for every confirmed code finding.
4. Add a VT emulator/state model, faithful Pi multi-listener harness, official lifecycle interleavings, child-process timeout tests, and filesystem fault injection.
5. Re-run `npm run check` and the focused 65-test suite plus all new tests.
6. Perform a fresh clean-room review of all 52 files and official Pi lifecycle/terminal source. Any remaining PARTIAL path must remain explicitly PARTIAL; the next round must not say overall PROVEN until every convergence condition in `round-005/plan.md` is met.
