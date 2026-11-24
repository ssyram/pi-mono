# Round 005 Bundle D — Disprove-First Review

## Review

- **Blocker:** F14 is confirmed with a wording correction: session capture attempts old-patch recovery, but suppresses a recovery exception and can admit a new managed epoch over an unproven terminal state.
- **Note:** F13 is only partially confirmed. Several temporary native-supported UI states disable managed mode for the remainder of the current run, not permanently across `finishRun()` or a later idle capture.
- **Correct:** F15 is disproved as a blanket claim. Prepared commits, stable-row attestation, and native commit have production consumers and executable regression coverage. Only the nonzero viewport-expansion path is unreachable through its current production caller.
- **Blocker:** F16 is confirmed. Current design/proof material contradicts the runtime phase set, viewport-growth implementation, terminal-support implementation, artifact guarantees, and its own convergence standard.

## Evidence basis and limitation

The requested `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` does not exist. The requested root `progress.md` exists but contains only `Status: In Progress` with empty Tasks, Files Changed, and Notes sections. This review therefore used the matching Round 005 plan at `my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/plan.md` as contextual evidence. That substitution cannot establish anything allegedly recorded in the missing root plan.

No tests were executed in this review. Existing tests were inspected as reachability and intended-behavior evidence; the concrete validations below remain required before a proof verdict.

## F13 — temporary supported UI states permanently disable managed mode

**Strict verdict: PARTIALLY CONFIRMED; the word “permanently” is disproved.**

### Attempted disproof

I looked for automatic re-entry after a visible overlay closes, tool expansion returns to its prior value, or another native-only transient clears. I also looked for broader reset paths that would disprove permanent disablement.

The first disproof fails within the current run: managed-render preflight rejects stopped TUI state, force-native rendering, changed tool expansion, and visible overlays (`managed-renderer.ts:149-154`). These outcomes are routed to fallback, and `startRun()` accepts managed entry only from `idle-native` (`runtime-coordinator.ts:49-52`). `enterFallback()` records `active-native-fallback` and reports that the plugin is disabled “for this run” (`runtime-coordinator.ts:214-219`). There is no consumer that observes an overlay/tool state clearing and re-enters managed mode during that same run.

The stronger permanent claim is false. `finishRun()` resets non-managed run state to `idle-native`, and a later `capture()` selects `idle-native` whenever `ctx.isIdle()` is true (`runtime-coordinator.ts:22-46`). Width recapture also has an explicit successful return to `active-managed` (`runtime-coordinator.ts:161-189`). The implementation itself therefore bounds fallback to a run/epoch rather than the lifetime of the extension.

### Exact evidence

- `runtime-coordinator.ts:43-45`: capture selects `idle-native` for an idle context and `active-native-fallback` otherwise.
- `runtime-coordinator.ts:49-52`: managed startup is gated on `idle-native`.
- `runtime-coordinator.ts:161-189`: successful width/native-commit recapture can activate a new renderer and restore `active-managed`.
- `runtime-coordinator.ts:214-219`: fallback is explicitly reported as disabled “for this run.”
- `managed-renderer.ts:149-154`: visible overlays, tool-expansion changes, force-native rendering, and stopped TUI state are native-fallback conditions.
- `runtime-coordinator.test.ts:93-109`: a hidden overlay remains managed, while loading in a non-idle context enters fallback. This disproves the claim for every temporary UI state.
- `managed-runtime.test.ts:131-171`: terminal images, visible overlays, and tool-expansion changes exercise fallback; width redraw exercises successful re-entry.

### Reachability and consumer impact

These paths are production-reachable through `session_start -> runtime.capture(ctx)`, `agent_start -> runtime.startRun()`, and managed render calls wired in `codex-viewport.ts`. Visible overlays and tool expansion are ordinary Pi UI capabilities even though the managed renderer deliberately delegates them to native rendering. The impact is availability/completeness, not immediate terminal corruption: after such a transient, later assistant/tool updates in the same run remain native because event forwarding is guarded by `runtime.isManaged()`.

### Concrete validation

Add a production-path test for each transient condition:

1. Enter `active-managed`.
2. Activate a visible overlay or change tool expansion.
3. Render once and assert `active-native-fallback`.
4. Clear the transient without ending the run.
5. Trigger another render and assert the intended policy explicitly: either managed mode re-enters after a fresh DSR/baseline attestation, or native fallback remains documented as run-scoped.
6. Call `finishRun()`, start a new idle run, and assert managed entry succeeds. This guards against accidentally turning run-scoped fallback into extension-lifetime disablement.

Until step 5 has a stated policy and regression test, F13 remains a completeness gap, not a global permanence bug.

## F14 — session capture suppresses old-owner recovery and allows an unsafe new epoch

**Strict verdict: CONFIRMED, with wording correction.** Capture does not omit recovery; it suppresses recovery failure.

### Attempted disproof

I looked for one of three safety barriers after old-owner recovery throws: propagation to the caller, forced fallback/disposal that blocks managed entry, or a terminal-state attestation before the new epoch is accepted. None exists in `capture()`.

`capture()` first detaches the current patch via `cancelCurrentEntry()`, then attempts `returnToNativeFromGate()`, `recoverSynchronously("session context replaced")`, or `dispose(false)` on the prior patch. The whole operation is wrapped in an empty `catch {}` (`runtime-coordinator.ts:22-38`). Execution then binds the new TUI/context and selects its phase from `ctx.isIdle()` (`runtime-coordinator.ts:39-46`). A subsequent `startRun()` can install a new patch because the new phase is `idle-native`.

Generation checks do not disprove the claim. `cancelCurrentEntry()` increments the generation and `handleReturned()` rejects stale patch callbacks, which protects JavaScript ownership identity; it does not prove that a failed native redraw left the physical terminal and Pi’s native baseline coherent. Likewise, `RuntimeSnapshotOwner` is unrelated to this trace: it serializes `/tsnapshot` leases (`runtime-snapshot-owner.ts:15-48`), whereas F14 is reached through `RuntimeCoordinator.capture()` on repeated `session_start` events.

### Exact evidence

- `runtime-coordinator.ts:22-38`: previous-patch return/recovery/disposal is attempted inside an empty `catch {}`.
- `runtime-coordinator.ts:39-46`: the new TUI/context and phase are accepted after the suppressed failure.
- `runtime-coordinator.ts:49-102`: an accepted `idle-native` context can proceed through patch installation and managed entry.
- `runtime-coordinator.ts:196-213`: generation and patch-identity guards reject stale callbacks but do not attest physical terminal recovery.
- `runtime-patch.ts:69-79`: synchronous recovery restores patch methods and invokes native recovery; that native recovery can throw.
- `packages/coding-agent/src/core/extensions/types.ts:550-556`: `session_start` is defined for `startup`, `reload`, `new`, `resume`, and `fork`, so capture replacement is not startup-only.
- `packages/coding-agent/src/core/agent-session.ts:2604` and `core/agent-session-runtime.ts:215,248,302,325,344,388`: reload/new/resume/fork paths emit repeated session starts.
- Existing `runtime-coordinator.test.ts` covers fallback and delayed-entry cancellation but has no repeated-capture test where `recoverSynchronously("session context replaced")` throws.

### Reachability and consumer impact

The trace is reachable without concurrency:

1. A session owns an installed managed patch.
2. A reload/new/resume/fork emits another `session_start`.
3. Recovery of the prior renderer throws after terminal/native state may already have changed.
4. `capture()` suppresses the exception and accepts the new idle context.
5. The next `agent_start` installs a new managed epoch over a terminal whose canonical native state was never established.

The impact crosses ownership and physical-terminal boundaries. Generation isolation prevents the old patch from later mutating coordinator state, but it cannot undo partial terminal bytes or establish a trustworthy native baseline. This is therefore a safety blocker, not merely missing diagnostics.

### Concrete validation

Add a failing-then-passing repeated-capture regression:

1. Enter managed mode on one `RuntimeCoordinator`.
2. Inject failure into the old patch’s native recovery, preferably after a detectable write prefix.
3. Emit/call a second `capture()` with an idle UI context.
4. Assert that no new managed patch, DSR entry, or managed terminal write is allowed until canonical recovery succeeds.
5. Assert an explicit surfaced error or `active-native-fallback` phase; do not accept silent continuation.
6. Retry with successful native recovery and assert exactly one new epoch becomes managed.
7. Verify old-generation callbacks remain ignored.

A unit assertion on phase alone is insufficient; the test must inspect terminal writes/native-render counts so partial old-owner effects cannot be hidden.

## F15 — prepared/stable-row/viewport-expansion/native-commit machinery is dead or needlessly complex

**Strict verdict: DISPROVED as stated. A narrower dead-branch finding is confirmed for nonzero viewport expansion.**

### Attempted disproof

I traced every named mechanism from producer to production consumer and then to tests.

#### Prepared commits — live and load-bearing

`TranscriptLedger.prepareCommit()` marks a contiguous finalized prefix as prepared; `commitPrepared()` and `cancelPrepared()` resolve it (`transcript-ledger.ts:97-136`). `ManagedRenderer.render()` prepares before constructing/writing the terminal plan and accepts only after the write; failures cancel (`managed-renderer.ts:72-175`). `transcript-ledger.test.ts:23-31,52-55` exercises prepare/commit/cancel behavior.

This is not dead. The mutable `prepared` state supplies a stale-candidate/reorder barrier. Replacing it with an immutable candidate may be possible, but no current proof shows equivalent behavior for reentrant render requests, component reorder, stale revisions, terminal-write failure, and committed-frontier ordering. Removing it now would not satisfy the required SCC-preservation burden.

#### Stable rows — live attestation; not dead

The baseline captures stable rows and whether they are fully known (`native-entry-baseline.ts:42-88`). `prepareNativeHandoff()` rejects unless stable rows fully attest the rows above the viewport and then compares them with the normalized native render (`native-handoff.ts:15-54`). `native-handoff.test.ts:42-53` verifies displaced-row rejection, and its successful handoff case verifies stable-row priming.

The revision/preview API in `stable-screen-rows.ts:1-37` may be more machinery than the current downward-only growth needs, but the row set, capacity, and `known` attestation are SCC-critical. No simpler replacement is proven across height rebase, growth, and native handoff.

#### Native commit — production-reachable and semantically distinct

`commitNatively()` first requires a seamless handoff, then calls Pi’s saved native `doRender`, then advances the managed commit frontier (`native-commit.ts:10-24`). `runtime-patch.ts:181-186` consumes the renderer’s `native-commit` result and routes success, rejection, or failure. `managed-runtime.test.ts` contains both “commits a multi-line finalized block as one native transition” and “fails open when the native commit render throws.”

This is not a redundant alias for handoff. Handoff proves baseline equivalence; native commit performs the native render that makes the finalized prefix authoritative before the managed ledger accepts it. Collapsing these operations without preserving handoff-before-render and native-render-before-frontier ordering would weaken soundness.

#### Viewport expansion — wired, but its nonzero behavior is unreachable

`planLiveRegionGrowth()` performs only downward growth and always calls `buildViewportExpansion(area.top, area.top)` (`live-region-growth.ts:9-16`). `buildViewportExpansion()` returns empty bytes and zero displacement whenever both arguments are equal (`viewport-expansion.ts:6-11`). Consequently, the production caller can never emit its scroll-region/CRLF expansion bytes or report displaced stable rows. `inline-entry.test.ts:18-21` asserts only the empty expansion case.

Thus the function is technically consumed, but its nonzero branch and associated history-byte channel are dead under the current growth algorithm.

### Reachability and consumer impact

Prepared commits, stable rows, and native commit all sit on the ordinary managed-render/native-finalization path. Removing them wholesale would affect the irreversible transcript frontier and native handoff correctness. Viewport expansion does not currently affect production output: every current caller supplies equal tops, so terminal history bytes remain empty and displacement remains zero.

### SCC-preserving simplification analysis

No blanket simplification is approved.

- **Prepared state:** not proven replaceable. An immutable candidate must preserve revision/ID validation, prohibit reorder of a candidate being written, preserve write-first/commit-frontier-second ordering, and remain correct under synchronous render reentrancy and write failure. Current evidence does not prove all of those obligations.
- **Stable rows:** not proven replaceable as a mechanism. `{ rows, capacity, known }` is consumed by handoff. Removing only revision/preview mutation still requires equivalence tests for every height-rebase and growth path.
- **Native commit:** not proven replaceable. It is the operation that transfers finalized output to Pi’s native renderer and must remain ordered after handoff validation and before ledger acceptance.
- **Viewport expansion:** replacing the current call result with constant empty history/zero displacement is observationally equivalent for every current `planLiveRegionGrowth()` input because the caller passes identical tops. That proves preservation of current emitted bytes and state transitions. It does **not** prove SCC against the documented upward-growth requirement: removing the mechanism would preserve current behavior while cementing an existing completeness failure. Resolve the F16 specification conflict first; either implement and test nonzero upward growth or delete both the unreachable code and the upward-growth claim.

### Concrete validation

- Prepared simplification: property-test old and proposed ledgers over attach/finalize/reorder/prepare/write-fail/cancel/commit sequences, including a reentrant render request. Compare emitted bytes, committed prefix, live suffix, and thrown stale-candidate cases.
- Stable-row simplification: replay entry baselines, height rebases, downward growth, any intended upward growth, and handoff. Compare `{stableRows, stableRowsKnown, displacedEntryRows}` and handoff decisions.
- Native commit simplification: assert one native render, handoff validation before that render, frontier acceptance only after successful render, unchanged frontier on throw, and no managed/native double ownership.
- Viewport expansion: add a test that requests terminal-bottom overflow. If the specification requires upward expansion, assert nonempty scroll-region bytes, reduced `top`, and stable-row displacement. If it does not, remove the unreachable branch and update all design/proof text in the same change.

## F16 — docs/evidence are stale, contradictory, and overclaim proof

**Strict verdict: CONFIRMED.**

### Attempted disproof

I compared high-level claims with runtime enums, production consumers, terminal detection, artifact writes, executable tests, and the Round 005 convergence gate. Multiple contradictions remain; they cannot all describe the current implementation.

### Exact evidence

1. **Runtime phase inventory is stale.** `docs/design/detailed-design.md:45-49` omits `native-commit-gate`, while `runtime-phase.ts:1-9` defines it and `runtime-coordinator.ts:161-189` actively uses native-commit recapture.

2. **Upward/history-growth proofs contradict production reachability.** `docs/design/architecture.md` §11, `docs/design/detailed-design.md` §10, `docs/design/proofs/scco-composition.md`, and `docs/design/detail/managed-renderer.md` discuss protected spill, stable-region scrolling, or upward overflow. Production `live-region-growth.ts:9-16` never changes `area.top` and always requests expansion from `top` to the same `top`; `viewport-expansion.ts:6-11` therefore always returns empty history bytes on that path.

3. **Terminal status is internally inconsistent.** `docs/design/known-state.md:79-85` describes terminal support as unfinished/unverified, while `detect-supported-terminal.ts:1-10` returns `"standard"` for TMUX and allowlists Apple Terminal, iTerm, WezTerm, kitty, and common ANSI `TERM` families. An allowlist is not verification, but the docs blur those two meanings rather than defining separate support and evidence statuses.

4. **Artifact durability language exceeds implementation evidence.** `README.md:52-61` describes snapshot artifact guarantees more strongly than `snapshot-artifacts.ts` implements: writes are direct `writeFile` operations, without a temporary-file/fsync/rename transaction. Existing snapshot tests cover names, permissions, contents, and pointer shape, not crash-atomic persistence.

5. **The audit inventory is stale.** The Round 005 plan says the audit object contains 52 non-test TypeScript files. The Round 005 specification inventory reports 67 TypeScript files total, 50 production and 17 test files, and notes that `inline-entry.ts` does not exist (`managed-entry.ts` is the entry implementation). A proof tied to the wrong source inventory cannot establish source completeness.

6. **Hard-death and IME claims lack implementation-level proof.** Current material delegates hard-death recovery outside the scoped plugin and admits IME safety as unverified; there is no SIGKILL/restart recovery test or IME integration test. Those properties must remain assumptions or exclusions, not proven guarantees.

7. **The evidence set violates its own convergence rule.** The Round 005 plan’s Convergence Gate forbids `PROVEN` while source paths are untraced, cross-boundary assumptions lack official-source evidence, confirmed findings lack failing-then-passing tests, non-decisional findings remain unfixed, or any SCCO dimension is incomplete. `findings-pool.md` explicitly labels F13-F16 unresolved candidates. The contradictions above and missing F14 regression independently prevent a proof verdict.

### Reachability and consumer impact

These are not cosmetic documentation defects:

- Omitting `native-commit-gate` hides a production state transition involved in ownership transfer and recovery.
- Claiming upward expansion where none is reachable misstates viewport completeness and invalidates proof composition based on displaced history rows.
- Calling a terminal allowlisted rather than verified changes the meaning of the acceptance boundary used by patch preflight.
- Overstating artifact durability can lead operators to treat diagnostic evidence as crash-atomic when it is not.
- A stale source count prevents a reviewer from knowing whether every production path was actually audited.

### Concrete validation

1. Generate the documented phase table from the `RuntimePhase` union and fail CI on drift; include transition consumers for every phase.
2. Add a terminal-bottom overflow regression that either reaches nonzero viewport expansion or proves the specification no longer requires it. Align architecture, detailed design, and SCCO proof text with the tested result.
3. Split terminal documentation into `allowlisted` and `verified` matrices. Run startup, DSR, managed render, resize recapture, native commit, overlay fallback, and shutdown recovery on every claimed verified terminal.
4. Fault-inject snapshot writes at each file boundary. If crash atomicity is required, test temporary write, sync, atomic rename, and current-pointer recovery. Otherwise narrow the README guarantee.
5. Derive source/test counts from one checked command and record the exact exclusion rules. Do not embed hand-maintained global counts in proof claims.
6. Add SIGTERM/normal shutdown recovery tests, explicitly exclude SIGKILL if no recovery mechanism exists, and add an IME composition integration test before claiming IME safety.
7. Re-run the Round 005 convergence gate only after F14 has a failing-then-passing regression and all accepted F13/F15/F16 findings are either fixed or explicitly scoped out.

## Final strict verdicts

| Claim | Verdict | Reason |
|---|---|---|
| F13 | **PARTIALLY CONFIRMED** | Certain temporary native-supported states cause fallback for the remainder of a run, but capture, run completion, and width recapture disprove extension-lifetime permanence. |
| F14 | **CONFIRMED — BLOCKER** | Recovery is attempted, but its failure is silently suppressed before a new idle context/epoch is accepted; generation guards do not prove physical terminal recovery. |
| F15 | **DISPROVED AS A BLANKET CLAIM** | Prepared commits, stable rows, and native commit are live, tested consumers. Only nonzero viewport expansion is unreachable through the current production caller; broader simplification lacks SCC proof. |
| F16 | **CONFIRMED — BLOCKER TO `PROVEN`** | Runtime phases, upward growth, terminal status, durability, source inventory, and unverified hard-death/IME guarantees conflict with current code or evidence, violating the audit’s own convergence gate. |
