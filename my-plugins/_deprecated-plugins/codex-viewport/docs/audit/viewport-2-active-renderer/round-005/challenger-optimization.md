# Round 005 SCCO Optimization Challenge

## Verdict

The **managed unfinished suffix + native finalized-prefix commit + native idle renderer** is the simplest architecture that can satisfy all five hard constraints together. Its core boundaries should be retained: a source-ordered frontier, single terminal ownership, native entry/return attestation, native ordinary commits for finalized history, and native full reflow on width change.

The current implementation is nevertheless **not yet a complete proof of that architecture**. It carries a dead plugin-history mechanism that contradicts the current design, uses an unnecessary mutable prepare/cancel protocol, and infers component identity/finality with heuristics that can commit content without positive immutability evidence. In addition, the specifications overclaim byte equivalence and fallback completeness.

This verdict is conditional on managed mode being available in ordinary supported Pi sessions. `active-native-fallback` is a recovery state, not evidence that the active-renderer requirement is met.

## Constraint basis

- **Single-copy history:** a logical item may cross the frontier once, in source order, and only Pi may turn that finalized prefix into native terminal history.
- **Native idle equivalence:** after a run, Pi owns rendering with a baseline equivalent to the physical terminal, or Pi performs a real recovery render.
- **Stable-row preservation:** normal managed diffs do not repaint or CRLF-scroll attested rows above the managed area.
- **AI isolation:** display code observes lifecycle/components but does not mutate messages, tools, persistence, provider input, or session data.
- **Plugin-only scope:** Pi components, editor, input, tools, and session semantics remain native; the plugin owns only run-scoped terminal scheduling and the unfinished viewport.

## Strictly simpler alternatives

| Alternative | Why it is simpler | Rejection |
|---|---|---|
| Leave Pi rendering active and suppress/filter selected writes | No ownership transfer or ledger | Two renderers still reason about one terminal; filtering cannot prove stable-row preservation or a single physical copy when Pi's diff baseline advances independently. |
| Render the suffix but defer every finalized item until `agent_end` | No incremental native commit | A long suffix remains volatile, creates the forbidden end-of-run layout jump, and can crowd fixed editor/footer space. It does not satisfy progressive finalized-history behavior. |
| Plugin-owned scroll-region history insertion | Avoid native commit/re-entry | The plugin must reproduce Pi's history/reflow semantics and risks inserting stale or duplicate revisions. This violates single-copy history and expands beyond plugin-only scope. |
| Prime Pi from internal fields without DSR/physical attestation | No entry query or handoff comparison | Internal state is not proof of terminal state after terminal/application interference. Ownership transfer and native idle equivalence become unprovable. |
| Full-screen/alternate-screen takeover | One simple rendering surface | It replaces Pi's inline renderer and terminal history behavior, violating native idle equivalence and plugin-only scope. |
| Disable managed mode whenever a proof is inconvenient | Minimal implementation | Safe fallback is not functional correctness. If this occurs in normal supported sessions, the plugin does not satisfy its active-renderer specification. |

No strictly simpler ownership architecture satisfies all constraints. The valid simplifications are inside the current architecture, not replacements for it.

## Proof-mechanism assessment

### Necessary and correctly placed

1. **Contiguous source-order frontier — keep.** `TranscriptLedger.prepareCommit()` selects only the maximal finalized component-bearing prefix (`transcript-ledger.ts:97-113`), while reorder validation protects the committed prefix (`transcript-ledger.ts:70-95`). This is the minimal proof against out-of-order tool/assistant completion.

2. **Terminal acceptance after the synchronized write — keep the ordering.** `ManagedRenderer.render()` writes the complete plan before accepting frame/area/stable state and ledger progress (`managed-renderer.ts:72-131`). Moving acceptance earlier would allow an unwritten frame to become logical truth; accepting after the write preserves the transaction invariant as far as a non-rollback terminal permits.

3. **Committed-component mutation guard — keep, but strengthen its input contract.** `assertCommittedSnapshots()` runs before a new transaction (`managed-renderer.ts:157-169`). Native history cannot be edited, so detecting a changed committed component is necessary; the guard is correctly placed before further managed output, but it cannot repair an item that was classified finalized too early.

4. **Native entry baseline and DSR-derived origin — keep.** `captureNativeEntryBaseline()` jointly derives stable rows, initial frame, and baseline committed components from native geometry and rendered-prefix agreement (`native-entry-baseline.ts:25-83`). Removing physical-origin evidence would make the first managed write capable of overwriting unknown native rows.

5. **Full visible-frame/cursor handoff attestation — keep.** `prepareNativeHandoff()` checks stable-row knowledge, provenance, images, visible lines, and cursor before mutating Pi baseline fields (`native-handoff.ts:15-54`). This is the correct proof boundary and placement: all predicates precede native-state mutation.

6. **Separate native operations for commit and width reflow — keep.** An ordinary native `doRender` commits finalized progress (`native-commit.ts:10-24`); width change performs a native redraw before recapture (`runtime-patch.ts:142-161`). The operations have different semantics even though their post-native recapture can share machinery.

7. **Recovery render on failed handoff — keep as recovery only.** `runtime-patch.ts:162-198` routes mismatched handoff, managed fallback, and write failure to native recovery. This protects AI isolation and eventual native ownership, but it cannot retroactively guarantee terminal single-copy semantics after a partial external write.

### Necessary idea, insufficient proof

#### Component identity and finality

`ComponentLedgerReconciler` currently uses constructor names for static finality, attaches an unknown component to the first unattached assistant item, and finalizes an opaque component merely when it is no longer the tail (`component-ledger-reconciler.ts:5-11,61-93`). These are observations, not positive evidence of identity or immutability.

A mutable unknown widget can cease being the tail, be marked finalized, enter the native commit frontier, and mutate later. The snapshot guard detects the mutation only after irreversible native history may already contain the old rendering. Similarly, “first unattached assistant” does not prove the component belongs to that lifecycle item when multiple components appear asynchronously.

This is the principal correctness gap: ledger ordering is proven only after an unproven lifecycle-to-component mapping.

## Recommendations

### R1 — Replace heuristic finality with a supported-ABI evidence contract

- **Internal reason:** Native history is irreversible; finality must be established before frontier eligibility, not inferred from tail position and repaired after mutation.
- **Affected invariants:** single-copy history, source ordering, stable-row preservation, plugin-only scope.
- **Migration impact:** define the supported Pi component shapes in the runtime probe; bind tool/assistant items through stable component identity exposed by those shapes; classify known immutable static components explicitly. Unknown components remain pending, or cause pre-ownership rejection when the layout is unsupported. Add tests with multiple unattached assistants, a mutable non-tail opaque component, and constructor-name changes/minification.
- **Why SCC remain satisfied:** **Sound** gains positive identity/finality evidence. **Complete** remains achievable for the declared normal Pi ABI and must be demonstrated there; unknown ABI fallback is only compatibility recovery. **Concise** keeps Pi components and lifecycle semantics rather than reimplementing them.
- **Effort:** Medium (1–2d).

### R2 — Make commit candidacy immutable; delete the mutable `prepared` state

- **Internal reason:** `prepareCommit()` marks items `prepared`, but `liveItems()` already includes them because it excludes only `committed`. Rendering behavior therefore does not depend on the mutation. `cancelPrepared()` only reverses that unnecessary mutation, and `ManagedRenderer.cancelPrepared()` suppresses cancellation errors (`managed-renderer.ts:171-175`), making a stale transaction harder to prove.
- **Affected invariants:** atomic frontier advance, source ordering, single-copy history.
- **Migration impact:** replace `prepareCommit()` with a pure `candidateCommit()` carrying ledger revision, IDs, components, and rendered lines; after terminal write success call `commitCandidate(candidate)`. Remove `"prepared"` from `CommitState`, `cancelPrepared()`, and cancellation tests; retain revision/identity validation at commit.
- **Why SCC remain satisfied:** **Sound** preserves “write first, frontier advance second” and stale-candidate validation. **Complete** behavior is unchanged. **Concise** removes a state, rollback path, and suppressed error without adding infrastructure.
- **Effort:** Short (1–4h).

### R3 — Delete the dead plugin-history/viewport-expansion channel

- **Internal reason:** `planLiveRegionGrowth()` only grows `bottom` downward and always calls `buildViewportExpansion(area.top, area.top)` (`live-region-growth.ts:9-16`). Consequently `ViewportExpansionPlan.bytes` and `displacedStableRows` are always empty/zero, yet `ManagedRenderer` still passes `growth.expansion.bytes` as `history`, and `terminal-render-plan.ts:1-9` preserves a history channel. This is dead architecture whose CRLF implementation (`viewport-expansion.ts:6-16`) contradicts the current “no plugin-owned history insertion” design.
- **Affected invariants:** stable-row preservation, single-copy history, plugin-only scope.
- **Migration impact:** remove `viewport-expansion.ts`, the `expansion` member from live-region growth, the `history` input from `buildTerminalRenderPlan`, and associated displaced-row updates that can only receive zero. Document the actual rule: managed geometry grows downward only; Pi native commit owns upward/history progress.
- **Why SCC remain satisfied:** **Sound** becomes stronger because ordinary managed output has no CRLF/history path. **Complete** retains downward capacity growth and native finalized-prefix commits. **Concise** removes an unreachable second history mechanism.
- **Effort:** Short (1–4h).

### R4 — Reduce `StableScreenRows` to the evidence it actually stores

- **Internal reason:** `StableScreenRows.previewAppend()` and `accept()` implement a revisioned append transaction, but the current renderer never calls either; it retains or slices stable rows instead. The class therefore advertises the deleted protected-history architecture.
- **Affected invariants:** native handoff equivalence and stable-row attestation; no functional invariant needs the unused revision protocol.
- **Migration impact:** remove `StableScreenPreview`, `revision`, `previewAppend()`, and `accept()`. Keep a small immutable `{ rows, capacity, known }` value or a focused constructor/accessor used by entry, height rebase, and handoff.
- **Why SCC remain satisfied:** **Sound** retains exactly the attested bytes and knowledge bit consumed by handoff. **Complete** behavior is unchanged. **Concise** eliminates misleading transactional machinery.
- **Effort:** Quick (<1h).

### R5 — Unify post-native recapture control flow, not native semantics

- **Internal reason:** `beginWidthRecapture()` and `beginNativeCommitRecapture()` differ only by phase label and both enter `beginRecapture()`, which calls the same recapture function (`runtime-coordinator.ts:161-189`). Separate labels create duplicated finish/failure branches without adding proof once a native frame is current.
- **Affected invariants:** single renderer ownership, width-reflow correctness, native idle equivalence.
- **Migration impact:** use one `native-recapture-gate` phase with a trigger/reason (`width-reflow` or `prefix-commit`) retained for journal diagnostics. Keep distinct pre-gate actions: width invokes full native redraw; commit invokes ordinary native render.
- **Why SCC remain satisfied:** **Sound** retains the different native operations and generation/abort gate. **Complete** preserves both transitions. **Concise** removes duplicated coordinator branches while keeping one explicit ownership state.
- **Effort:** Short (1–4h).

### R6 — Turn normal-session availability into an acceptance obligation

- **Internal reason:** `RuntimeCoordinator.startRun()` routes missing prerequisites, patch failure, or entry failure to `active-native-fallback` (`runtime-coordinator.ts:49-102`), and `enterFallback()` merely disables the plugin for the run (`runtime-coordinator.ts:214-219`). This is safe recovery but does not implement the requested active renderer.
- **Affected invariants:** functional completeness and native idle equivalence; AI isolation remains intact during fallback.
- **Migration impact:** define the supported Pi/version/TTY matrix; require the runtime probe and entry baseline to succeed in ordinary sessions in CI/smoke acceptance; report fallback reason distinctly as unsupported/recovery. Do not count a test that reaches native fallback as a managed-renderer correctness pass.
- **Why SCC remain satisfied:** **Sound** still fails open for genuinely unsupported layouts. **Complete** now means the feature operates on the declared normal matrix. **Concise** uses the existing probe/fallback rather than adding another renderer.
- **Effort:** Medium (1–2d), mostly acceptance coverage.

### R7 — Split physical acceptance from semantic naming at native commit

- **Internal reason:** `ManagedRenderer.acceptPrepared()` names the ledger prefix `committed` immediately after the managed terminal write (`managed-renderer.ts:133-147`), before `commitNatively()` calls Pi's ordinary renderer (`native-commit.ts:16-23`). The state is harmlessly discarded on native failure, but the proof language incorrectly equates “visible finalized managed frame” with “native history commit.”
- **Affected invariants:** transaction clarity, single-copy history, failure reasoning.
- **Migration impact:** either rename ledger state to `finalized-visible`/`crossed-frontier` and define native commit as a later ownership transition, or defer the semantic `committed` transition through the existing `onCommitted` callback after `originalDoRender` returns. Prefer renaming if deferral complicates recapture state; explicitly scope partial native-write exceptions as unrecoverable terminal failures.
- **Why SCC remain satisfied:** **Sound** aligns state names and proof steps with actual side effects. **Complete** retains the same terminal behavior. **Concise** can be achieved as a naming/proof correction without a new rollback mechanism.
- **Effort:** Short (1–4h) for naming/spec alignment; Medium if transition timing changes.

## Specification contradictions to resolve

1. **Deleted history insertion vs proof that still relies on it.** `docs/design/architecture.md §11` and `docs/design/detailed-design.md §10` say `ProtectedHistoryRows` and plugin history insertion are deleted and `StableScreenRows` is attestation-only. `docs/design/proofs/scco-composition.md` still claims soundness because “history only scrolls the top stable region” and because ledger/protected/stable/frame accept together; `docs/design/detail/managed-renderer.md` likewise describes protected spill and “upward-on-overflow.” The current code has no reachable upward expansion. The proof must be rewritten around native prefix commit, not preserved as evidence for a removed design.

2. **Downward-then-upward growth vs actual downward-only code.** The README/architecture claim overflow eventually moves `top`; `live-region-growth.ts:11-16` never changes it. Choose the simpler code-consistent contract: no plugin upward/history movement; crop pending content to capacity and let native prefix commits advance history. If upward movement is truly required, the current implementation is incomplete and the CRLF path needs a new single-copy proof.

3. **“Exact visible bytes” vs normalized-line comparison.** The handoff implementation normalizes both physical and native lines before comparison (`native-handoff.ts:28-36`), so it proves equality under `normalizeLines`, not byte-for-byte equality. Specify terminal-cell/normalized-render equivalence and prove normalization preserves every Pi diff-relevant attribute, or compare the exact canonical strings Pi stores. Do not claim raw byte equality.

4. **Fallback equivalence vs irreversible output failures.** The design says plugin error returns to native display, while terminal write and native render can partially side-effect before throwing. Recovery can restore ownership but cannot erase arbitrary scrollback duplication. Scope the guarantee to failures before output and successful complete writes; classify partial external writes and hard process death as explicit non-rollback boundaries.

5. **Unknown-ABI fallback vs active-renderer completeness.** “Fail open on unknown ABI” is compatible with safety, but not with a claim that the plugin satisfies its purpose on normal sessions. The spec needs a declared supported matrix where managed entry is mandatory, plus a separate unsupported-environment recovery statement.

## Recommended minimal end state

1. On a supported normal session, probe Pi internals and capture a DSR-backed native entry baseline.
2. Patch `doRender`/`stop` so exactly one renderer owns the terminal.
3. Maintain a positively bound, source-ordered ledger; only positively finalized contiguous items may cross the frontier.
4. Render the unfinished suffix and native editor/footer with absolute synchronized writes; grow only downward and never emit plugin history bytes.
5. After a successful managed write exposes a finalized frontier, attest the complete native baseline, invoke one ordinary Pi render, and recapture from the first unfinished component.
6. On width change, invoke one native full reflow and use the same post-native recapture gate.
7. On drain, prime Pi only after full normalized-cell, cursor, geometry, stable-row, and provenance equivalence; otherwise perform one native recovery.

That architecture retains every load-bearing proof mechanism while deleting the structures inherited from plugin-owned history insertion. Revisit a more complex design only if Pi cannot expose stable lifecycle/component identity for the supported ABI or if a product requirement explicitly demands plugin-owned upward history movement.
