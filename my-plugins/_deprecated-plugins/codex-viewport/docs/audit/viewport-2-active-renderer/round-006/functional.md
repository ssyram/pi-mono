# Round 006 Clean-Room Functional Audit

## Review

- **Correct:** The managed render transaction now uses one transaction-local component observation for prepare and paint, performs one synchronized terminal write, and advances ledger/frame/geometry state only after that write returns (`managed-renderer.ts:75-89`, `managed-renderer.ts:123-136`).
- **Correct:** Ledger preparation remains the maximal finalized source-order prefix, guarded by a revision/range/identity token (`transcript-ledger.ts:70`, `transcript-ledger.ts:97-131`).
- **Correct:** Native redraw, native commit, dirty-gate catch-up, managed fallback, and terminal-write failure paths restore/fence ownership rather than retaining a falsely valid Pi baseline (`runtime-patch.ts:70-91`, `runtime-patch.ts:114-122`, `runtime-patch.ts:165-198`; `fence-native-transition-failure.ts:4-15`).
- **Correct:** Entry, recapture, finish, shutdown, stop, snapshot, and session-successor paths contain identity/cancellation closure guards (`runtime-coordinator.ts:19-27`, `runtime-coordinator.ts:65-105`, `runtime-coordinator.ts:126-153`, `runtime-coordinator.ts:170-207`).
- **Blocker:** None within the implemented contract.
- **Note:** No confirmed new non-decisional functional defect was found.
- **Note:** `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` did not exist. `progress.md` contained only an empty in-progress template, so neither supplied additional scope or acceptance criteria.

## Re-proved transactions

### 1. Managed render and render-cache transaction

**PRE**

- Runtime patch is the sole active renderer owner.
- Width still equals the managed epoch width.
- TUI is running, no force render/tool-expansion/visible-overlay/native-only content precondition fires, and ledger reconciliation succeeds.
- Every component render is observed at most once through the transaction-local cache for prepare and managed paint.

**Invariant**

- The cache exists only for one `ManagedRenderer.render()` call; it does not persist across Pi invalidation epochs (`managed-renderer.ts:75-89`). This is required because official Pi treats invalidation and render scheduling as distinct operations: `Component.invalidate()` is part of the contract and `Container.invalidate()` propagates it (`packages/tui/src/tui.ts:70-87`, `packages/tui/src/tui.ts:256-295`). Official cached components clear render state on invalidation (`packages/tui/src/components/box.ts:30-74`, `packages/tui/src/components/markdown.ts:141-151`, `packages/tui/src/components/text.ts:38-45`, `packages/tui/src/components/image.ts:54-61`).
- Prepared lines and pending paint lines for the same component come from the same cached observation.
- Ledger frontier, accepted stable rows, displacement provenance, area, and previous frame remain unchanged until terminal write success.

**POST**

- Success: `terminal.write(bytes)` returns before `acceptPrepared` and frame/geometry acceptance (`managed-renderer.ts:123-128`).
- Write failure: prepared state is cancelled, no memory preview is accepted, and the outcome enters native recovery (`managed-renderer.ts:123-136`; `runtime-patch.ts:197-198`).
- Pre-write failure: the prepared batch is cancelled and the old accepted state remains authoritative (`managed-renderer.ts:131-136`).

**Reachable tests**

- `managed-runtime.test.ts`: one component observation across prepare and paint.
- `managed-runtime.test.ts`: terminal-write failure does not accept or replay the prepared transaction.
- `managed-runtime.test.ts`: atomic native commit of finalized multi-line blocks.
- `fixed-frame.test.ts`, `terminal-plan.test.ts`: bounded frame/cursor plan and absolute-row diff behavior.

**Result:** Proven for the current implementation and mocked terminal contract. Physical rollback after a partially accepted OS/terminal write remains outside the API contract, not a new defect.

### 2. Ledger reconcile, prepare, commit, and cancel

**PRE**

- Item IDs and component identities are unique.
- Existing committed items form the source-order prefix.
- Reconciliation has not detected deletion, reorder, or mutation of committed components.

**Invariant**

- Only the non-committed suffix may reorder by current component order (`transcript-ledger.ts:70`).
- `prepareCommit` selects exactly the contiguous finalized prefix beginning at the frontier; it stops at the first pending or unattached item (`transcript-ledger.ts:97`).
- At most one prepared batch exists, and its token binds ledger revision, range, and item IDs.
- A later finalized item cannot pass an earlier pending item.

**POST**

- `commitPrepared` advances only the token-bound prepared prefix (`transcript-ledger.ts:122`).
- `cancelPrepared` returns the same range to live without moving the frontier or changing finality (`transcript-ledger.ts:131`).
- Managed acceptance occurs only after the synchronized write, preserving source-order, single-copy memory provenance.

**Reachable tests**

- `transcript-ledger.test.ts`: maximal finalized source-order prefix.
- `transcript-ledger.test.ts`: parallel completion cannot cross an earlier pending item.
- `transcript-ledger.test.ts`: stale prepared tokens and mutation/reorder guards.
- `managed-runtime.test.ts`: prepared multi-line block commits atomically after the managed frame write.

**Result:** Proven locally. The evidence that declares an opaque component final is intentionally left as a design gate below.

### 3. Native commit and native-failure fence

**PRE**

- Managed state supplies attested stable rows, current physical frame, cursor, geometry, displacement provenance, and finalized-row count.
- Native tree render contains no terminal image and can be normalized.

**Invariant**

- `prepareNativeHandoff` rejects incomplete attestation, inadequate displacement coverage, image output, missing/different cursor, or different visible bytes before mutating Pi baseline fields (`native-handoff.ts:15-57`).
- A native commit calls the saved Pi renderer only after seamless handoff preparation (`native-commit.ts:16`).
- Any exception after native transition begins disables the patch, restores methods, emits terminal cleanup best-effort, and invalidates the native baseline (`runtime-patch.ts:165-188`; `fence-native-transition-failure.ts:4-15`).

**POST**

- Success: native renderer owns a baseline matching the attested physical frame and the coordinator may recapture the first unfinished suffix.
- Rejection: no native baseline is primed; runtime performs native recovery.
- Native exception: `previousLines`, dimensions, viewport origin, and Kitty IDs cannot remain falsely authoritative because fencing clears them (`fence-native-transition-failure.ts:11`; `recover-native-renderer.ts:12`).
- A subsequent native render is therefore forced to rebuild from an invalid baseline rather than diff from a fabricated successful transition.

**Reachable tests**

- `native-handoff.test.ts`: physical bytes, cursor, stable-row attestation, and displacement rejection.
- `managed-runtime.test.ts`: native-commit render failure fences the baseline and restores ownership.
- `resize-epoch.test.ts`: width-redraw and dirty-gate catch-up failures fence native state.
- `runtime-patch.test.ts`: synchronous recovery and method restoration.

**Result:** Proven for failure containment and memory provenance. Terminal bytes already emitted before an exception cannot be rolled back; this is an explicit external boundary.

### 4. Lifecycle and asynchronous closure

**PRE**

- Each entry/recapture attempt captures the current generation, phase, patch identity, and abort controller.
- At most one current patch is associated with the coordinator context.

**Invariant**

- Starting/replacing/cancelling an entry increments generation and cancels the session-owned cursor query and abort controller (`runtime-coordinator.ts:19-27`, `runtime-coordinator.ts:196-198`).
- Entry completion is accepted only when generation, phase, and exact patch identity still match (`runtime-coordinator.ts:170-177`).
- Recapture completion additionally requires the exact current abort controller (`runtime-coordinator.ts:190-194`, `runtime-coordinator.ts:207`).
- Finish and shutdown cancel coordinated snapshot capture before ownership closure (`runtime-coordinator.ts:126-153`).

**POST**

- Delayed entry/recapture cannot resurrect a returned, replaced, or disposed patch.
- Agent finish either enters draining handoff or closes through native recovery.
- Shutdown ends in `disposed` even if return/recovery reports an error.
- Direct TUI stop cancels snapshot ownership synchronously and restores/fences renderer ownership before the original stop returns (`runtime-patch.ts:114-122`).

**Reachable tests**

- `runtime-coordinator.test.ts`: delayed entry closure and session successor identity.
- `managed-runtime.test.ts`: finish/drain and synchronous recovery closure.
- `snapshot-lifecycle.test.ts`: shutdown and direct-stop cancellation.
- `resize-epoch.test.ts`: stale recapture completion cannot reactivate the patch.

**Result:** Proven for in-process lifecycle identity and closure.

### 5. Snapshot lease closure

**PRE**

- No snapshot lease is already active for the selected current owner.
- Terminal writer replacement succeeds.

**Invariant**

- Release/cancel is idempotent and restores the writer only if the lease still owns it (`snapshot-lease.ts:56-61`).
- Diagnostic owner rendering is explicitly bounded by the lease; ordinary writes are blocked/replayed or dropped according to release/cancel.
- Runtime snapshot ownership clears active state before requesting at most one catch-up render (`runtime-snapshot-owner.ts:54-55`).

**POST**

- `executeSnapshot` releases the lease in `finally`, including capture failure and abort (`execute-snapshot.ts:24`, `execute-snapshot.ts:48`, `execute-snapshot.ts:58`).
- Coordinated cancellation aborts the current execution (`coordinated-snapshot.ts:25`).
- Shutdown, session replacement, run finish, and direct stop cannot retain the old terminal writer lease.

**Reachable tests**

- `snapshot-lifecycle.test.ts`: shutdown and direct-stop cancellation, blocked-byte drop, and no stale replay.
- `snapshot-artifacts.test.ts`: atomic private publication and failure cleanup.
- `native-tui-snapshot.test.ts`: native-owner diagnostic capture.

**Result:** Proven for synchronous lease closure and the tested asynchronous capture paths.

## Decision gates — not findings

1. **Crop/overflow gate.** Current executable behavior crops the oldest pending transcript view at terminal bottom. Older design proof files still describe upward growth and protected-row spill. Choosing crop versus upward displacement/history behavior is a product/design decision, so this audit does not report the current crop policy as a defect.
2. **Component finality gate.** Constructor-name classification, lifecycle events, and non-tail opaque placement are implementation evidence, but official Pi exposes no universal component identity/finality/purity contract. Changing that evidence policy is a design decision, not a functional finding.
3. **Fallback/finality-of-recovery gate.** The implementation fails open to native ownership and invalidates the baseline after transition failure. Whether to attempt same-run managed recapture automatically is an open recovery-policy decision, not a defect.
4. **Handoff/terminal boundary gate.** Cursor visibility/modes, complete ANSI grammar, terminal matrix behavior, direct foreign stdout writers, partial writes, and hard process death remain outside the locally proved contract.

## SCCO Optimization

**Sound**

- The proof composes only locally established facts: unique owner, transaction-local render observation, maximal finalized-prefix preparation, one synchronized write before memory acceptance, baseline invalidation on native-transition failure, and generation/identity fencing on asynchronous completion.
- It does not infer physical rollback, universal component purity/finality, or cross-terminal ANSI equivalence.

**Complete within the implemented contract**

- Entry/active render, ledger prepare/commit/cancel, native commit/recovery, width recapture, drain/stop/shutdown, snapshot lease closure, and stale async completion are all represented in source and reachable automated tests.
- The remaining crop/finality/fallback and terminal/handoff questions are explicitly separated as decision or environment gates.

**Concise**

- The plugin does not replace Pi messages, tools, editor, provider, session, or persistence semantics. The added proof obligations remain bounded to renderer ownership, ledger provenance, physical frame state, native handoff, and snapshot capture.

**Optimization**

- A transaction-local render cache is the minimal safe optimization: it removes duplicate observations inside one atomic transaction without carrying cached output across Pi invalidation boundaries.
- Reusing component output across transactions would conflict with Pi’s invalidation contract; observing components repeatedly inside one transaction would reintroduce divergent prepare/paint bytes.
- Baseline invalidation plus restored native methods is the minimal safe exception fence. Attempting to reconstruct a partially completed native diff would require terminal acknowledgements and grammar/state knowledge the API does not provide.
- Generation/patch/abort identity checks are sufficient to reject stale lifecycle completions without extension-owned cross-session global mutable state.

## Verification

- `node --test --import tsx my-plugins/codex-viewport/*.test.ts` — **PASS**, 78 tests, 16 suites, 0 failures/skips/cancellations/todos.
- `npx tsc -p my-plugins/codex-viewport/tsconfig.json` — **PASS**, no diagnostics.

## Conclusion

Current render-cache, lifecycle-closure, ledger, snapshot, and native-failure-fencing transactions satisfy their stated local PRE/Post/Invariant obligations under the mocked terminal and official Pi ABI assumptions. No new non-decisional functional defect was confirmed. Overall production proof remains gated by the explicitly open crop, component-finality, fallback-recapture, handoff-state, terminal-matrix, partial-write, and hard-death decisions/boundaries.
