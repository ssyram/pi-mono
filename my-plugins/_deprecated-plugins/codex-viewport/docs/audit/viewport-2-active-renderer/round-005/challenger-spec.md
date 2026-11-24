<results>
<files>
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/principles.md -- Core Sound/Complete/Concise ownership, ordering, isolation, and recovery contracts.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/architecture.md -- Runtime state machine, geometry, ledger, commit, resize, handoff, and crash contracts.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/detailed-design.md -- Module responsibilities and detailed transaction/geometry rules.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/known-state.md -- Validation claims, risks, and implementation status.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/fixes/atomic-block-native-commit.md -- Atomic block/native commit correction and regression obligations.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/README.md -- Public runtime, guarantees, snapshot, recovery, and verification claims.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/live-region-growth.ts -- Demand-driven area growth implementation.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/transcript-ledger.ts -- Finalized-prefix and atomic commit invariants.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-renderer.ts -- Managed single-write transaction and fallback routing.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.ts -- Renderer ownership/lifecycle transitions.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.ts -- Physical-frame/cursor equality and baseline priming.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/volatile-region.ts -- Editor/footer/widget allocation and slack placement.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/snapshot-lease.ts -- Snapshot write interception and replay.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/snapshot-artifacts.ts -- Snapshot persistence and permissions.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-runtime.test.ts -- Main managed/native regression coverage.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/transcript-ledger.test.ts -- Ledger invariant coverage.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.test.ts -- Handoff coverage.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/resize-epoch.test.ts -- Width/resize coverage.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/tui-snapshot.test.ts -- Snapshot isolation and replay coverage.
</files>

<answer>
The scoped inventory contains 67 TypeScript files: 50 production files and 17 test files. No file named `inline-entry.ts` exists; entry implementation is `managed-entry.ts`.

## Normative source inventory

- `principles.md:9-16`: stable streaming, one active suffix, contiguous finalized-prefix history, semantic ordering, no duplicate history, limited takeover.
- `principles.md:20-29`: AI/session immutability, idle-native equivalence, recovery equivalence, fail-open behavior, IME safety, Editor/footer reservation, single owner, native component reuse.
- `principles.md:33-40`: prohibited duplicate redraw, concurrent ownership, ordering breakage, residual plugin state, data mutation, and full-TUI replacement.
- `architecture.md:7-15,19-36,52-68,82-97,101-127`: ownership phases, geometry, ledger states, single-write transaction, resize, handoff, fallback, and hard-death rules.
- `detailed-design.md:7-24,39-49,54-76,80-88,92-106,110-134`: module/type contracts, entry, demand geometry, atomic native commit, resize, write failure, handoff, side-effect restrictions.
- `known-state.md:7-33`: KS-1 through KS-7 runtime invariants.
- `known-state.md:35-69`: claimed test/global-Pi validation.
- `known-state.md:71-85`: D-layer status and known limitations.
- `atomic-block-native-commit.md:50-113`: `VisualBlock` ownership, pending-suffix ownership, native commit sequencing, footer-only slack, and failure behavior.
- `atomic-block-native-commit.md:117-167`: P1-P4 claims, regression gates, and implementation-status table.
- `README.md:7-21,31-61,65-79`: public guarantees, snapshot semantics, recovery limitations, loading restrictions, and verification commands.

Q.A/Q.E sections in `principles.md:42-60` are rationale/context rather than independently testable normative contracts.

## Findings

### Complete / major violation

**C-001 — Upward overflow growth is not implemented.**

- Spec: `architecture.md:54-58`, `detailed-design.md:67-76`, `known-state.md:11-17`: grow downward until `bottom === terminalHeight`; remaining overflow must move `top` upward, scroll the managed region, and crop only pending transcript content.
- Code: `live-region-growth.ts:planLiveRegionGrowth` computes only `downwardGrowth`; it always calls `buildViewportExpansion(area.top, area.top)`. When the area is already at terminal bottom, `top` and `bottom` remain unchanged and no expansion bytes are produced.
- Reachability: Any active managed render whose intrinsic demand exceeds an area already ending at terminal height.
- Reproduction:
  `planLiveRegionGrowth(createInlineViewportArea(80, 24, 10, 24), 6)` returns `{top:10,bottom:24}` and empty expansion. The contract requires upward displacement of six rows, subject to available stable rows.
- Tests: `inline-entry.test.ts` covers only downward growth (`top:10,bottom:20`, overflow `6`); no test covers terminal-bottom upward overflow.
- Classification: Soundness and completeness failure; this can leave live content missing or stale rather than merely causing extra redraw.

### Sound

**S-001 — Finalized-prefix ordering and atomicity are implemented.**

- Spec: `principles.md:12-14,46-47`; `architecture.md:60-68`; `atomic-block-native-commit.md:68-84`.
- Code: `transcript-ledger.ts:prepareCommit`, `commitPrepared`, `reorderByComponents`; `managed-renderer.ts:prepareCommit/acceptPrepared`.
- Tests: `transcript-ledger.test.ts` covers pending blockers, finalized prefixes, stale preparations, committed-prefix validation; `managed-runtime.test.ts` covers multi-line native commit.
- Verdict: Supported. Later finalized items cannot cross an earlier pending item, and a prepared component commits as one unit.

**S-002 — Managed/native ownership is explicitly serialized.**

- Spec: `principles.md:28,35`; `architecture.md:19-36,87-97`; `README.md:7-21`.
- Code: `runtime-coordinator.ts`, `runtime-patch-preflight.ts`, `runtime-patch.ts`, `restore-runtime-patch-methods.ts`.
- Tests: `runtime-coordinator.test.ts`, `runtime-patch.test.ts`, `managed-runtime.test.ts`.
- Verdict: Supported for recognized Pi ownership. Foreign direct `process.stdout` writers remain outside the guarantee, as admitted by `README.md:47`.

**S-003 — Handoff baseline proof is implemented.**

- Spec: `architecture.md:117-119`; `detailed-design.md:123-124`; `atomic-block-native-commit.md:103-113`.
- Code: `native-handoff.ts:prepareNativeHandoff`; exact visible-row, cursor, geometry, image, and baseline comparisons.
- Tests: `native-handoff.test.ts`, `managed-runtime.test.ts`.
- Verdict: Supported for the tested native-frame model.

**S-004 — Committed-component mutation is detected.**

- Spec: `architecture.md:117-119`; `detailed-design.md:80-88`.
- Code: `managed-renderer.ts:assertCommittedSnapshots`.
- Tests: committed mutation/fallback coverage in `managed-runtime.test.ts`.
- Verdict: Supported.

**S-005 — Editor/footer reservation and Footer-only slack are implemented.**

- Spec: `principles.md:27`; `atomic-block-native-commit.md:88-100`; `README.md:31-45`.
- Code: `volatile-region.ts:volatileLiveCapacity/renderVolatileRegion`.
- Tests: oversized-widget/editor/footer cases in `managed-runtime.test.ts`; bottom-slack regressions.
- Verdict: Supported for normal dimensions. Mandatory editor+footer overflow intentionally falls back native.

**S-006 — AI/session isolation is structurally respected.**

- Spec: `principles.md:20-21,39`; `detailed-design.md:128-130`; `README.md:7-21`.
- Code: `codex-viewport.ts` observes lifecycle events and patches rendering only; `component-ledger-reconciler.ts` binds existing components.
- Tests: `runtime-event-isolation.test.ts`, `managed-runtime.test.ts`.
- Verdict: No mutation path was found in the scoped implementation.

**S-007 — Failure paths generally fail open.**

- Spec: `principles.md:25,35`; `architecture.md:117-127`; `detailed-design.md:80-88,110-130`.
- Code: `recover-native-renderer.ts`, `runtime-failure.ts`, `runtime-coordinator.ts`, `managed-renderer.ts`.
- Tests: native-render failure, managed terminal-write failure, stop/shutdown recovery in `managed-runtime.test.ts`.
- Verdict: Supported only up to terminal-write/native-render return boundaries; partial writes and hard process death are explicitly outside proof.

### Complete / ungoverned or unverified

**C-002 — Hard-death recovery is specified but not implemented in this plugin.**

- Spec: `principles.md:24,38`; `architecture.md:123-124`; `known-state.md:31-33`; `README.md:47`.
- Code: No crash-recovery/session-replay implementation exists in the scoped plugin; recovery is delegated to Pi.
- Tests: No SIGKILL/restart test was found in the named test inventory.
- Reproduction: Kill Pi during an in-flight assistant/tool update, restart the same session, and compare restored JSONL against the pre-death terminal state.
- Classification: Contract is ungoverned by plugin code and tests. The stated guarantee depends on external Pi persistence semantics.

**C-003 — IME safety is admitted as unverified.**

- Spec: `principles.md:26`; `known-state.md:79-85`; `README.md:47`.
- Code: `query-terminal-cursor.ts` buffers/replays input, but no composition/candidate-window handling exists.
- Tests: DSR/input replay tests exist; no Apple Terminal Chinese IME integration test.
- Reproduction: During managed entry or width recapture, type Chinese composition while DSR is outstanding; verify no duplicated/lost composition or candidate-window displacement.
- Classification: Soundness evidence gap, not proven implementation failure.

**C-004 — Terminal support claims conflict.**

- Spec/status: `known-state.md:79-85` says iTerm2, Kitty, and WezTerm are unfinished; `README.md:47` describes direct writers/IME limitations.
- Code: `detect-supported-terminal.ts:detectSupportedTerminal` explicitly returns `"standard"` for `Apple_Terminal`, `iTerm.app`, `WezTerm`, and `kitty`.
- Tests: No dedicated terminal-detection/integration tests were found.
- Reproduction: `detectSupportedTerminal({TERM_PROGRAM:"kitty"})` returns `"standard"`, allowing managed takeover despite the known-state “unfinished” status.
- Classification: Internal stale/contradictory support claim. Either “allowlisted” or “finished/supported” needs a precise distinction.

**C-005 — Snapshot durability is weaker than the README wording.**

- Spec: `README.md:52-61` requires artifacts to be durable before successful completion.
- Code: `snapshot-artifacts.ts:secureWrite/writeSnapshotArtifacts` writes each file directly with `writeFile`; there is no temporary-file/fsync/rename transaction.
- Tests: `snapshot-artifacts.test.ts` covers names, permissions, contents, and pointer shape, not crash-atomic persistence.
- Reproduction: Interrupt the process during artifact writing and inspect whether `latest.json` or individual files reference/contain partial data.
- Classification: Optimization/crash-safety gap; direct writes are reachable and can leave partial artifacts.

### Concise

**N-001 — Normal managed diffs avoid history scrolling and use absolute rows.**

- Spec: `detailed-design.md:110-130`; `README.md:7-21,31-45`.
- Code: `screen-frame-diff.ts:diffInlineViewport`, `terminal-render-plan.ts:buildTerminalRenderPlan`.
- Tests: `fixed-frame.test.ts`, `terminal-plan.test.ts`, `managed-runtime.test.ts`.
- Verdict: Supported for ordinary managed diffs.

**N-002 — Upward geometry expansion still emits scroll-region/CRLF bytes.**

- Spec: `architecture.md:54-58` permits top-region displacement for real overflow; `detailed-design.md:132-134` forbids ordinary diff CRLF scrolling and plugin-created history insertion.
- Code: `viewport-expansion.ts:buildViewportExpansion` emits `CSI r`, repeated `\r\n`, and reset-region bytes.
- Classification: Not automatically a violation: it is the specified geometry-expansion path, not history insertion. However, because C-001 never reaches this path, its intended behavior is currently untested/unreachable for terminal-bottom overflow.

**N-003 — Native commit is intentionally a second renderer operation.**

- Spec: `architecture.md:87-97`; `atomic-block-native-commit.md:103-113`.
- Code: `native-commit.ts:commitNatively` calls saved Pi `doRender` once after managed write acceptance; recapture is coordinated by `runtime-coordinator.ts`.
- Tests: native-render count and DSR ordering in `managed-runtime.test.ts`.
- Verdict: Consistent with the adopted boundary, not a duplicate-history violation.

### Optimization

**O-001 — Demand-driven downward growth is implemented.**

- Spec: `architecture.md:54-58`; `known-state.md:11-17`; `README.md:11-15`.
- Code: `live-region-growth.ts`.
- Tests: `inline-entry.test.ts`, demand-driven tests.
- Verdict: Supported only for unused rows below `bottom`; upward continuation is C-001.

**O-002 — Width is the only mandatory full native reflow.**

- Spec: `detailed-design.md:92-106`; `known-state.md:23-25`; `README.md:31-45`.
- Code: `runtime-coordinator.ts`, `width-reentry.ts`, `managed-runtime.test.ts`.
- Tests: width test asserts one native full redraw and two DSR queries.
- Verdict: Supported in the fake runtime.

**O-003 — Snapshot diagnostics block/replay writes in order.**

- Spec: `README.md:52-61`.
- Code: `snapshot-lease.ts:createSnapshotLease`, `native-snapshot-target.ts`, `runtime-snapshot-owner.ts`.
- Tests: `tui-snapshot.test.ts`, `native-tui-snapshot.test.ts`.
- Verdict: Supported for synchronous writes; replay durability remains C-005.

## Internal contradictions and stale claims

- `detailed-design.md:45-49` lists `RuntimePhase` without `"native-commit-gate"`, while `runtime-phase.ts` and `runtime-coordinator.ts` define and use `"native-commit-gate"`. This is a direct state-machine spec/code contradiction.
- `atomic-block-native-commit.md:3` says the D-layer correction is implemented, while its implementation table around `:149-167` records `known-state.md` as updated to document an unsatisfied/current defect. The status language is internally inconsistent.
- `known-state.md:79-85` calls iTerm2/Kitty/WezTerm unfinished, while `detect-supported-terminal.ts` allowlists them.
- The requested “52 non-test files” does not match the scoped TypeScript inventory: 50 production and 17 test files were found. This is an audit-scope/count discrepancy, not a runtime defect.

## Nits

- `runtime-failure.ts:notifyRuntimeFailure` silently swallows notification exceptions.
- `component-shapes.ts` uses structural casts for Pi components; this is appropriate for ABI probing but not compile-time ABI proof.
- `snapshot-artifacts.ts` validates session IDs but does not document cleanup/retention of accumulated snapshots.
- `terminal-app-capture.ts` is inherently macOS/Terminal.app-specific despite README’s broader terminal support language.
- `detect-supported-terminal.ts` returns only `"standard"`; terminal-specific capability distinctions are not represented.

No files were modified. The available tool surface was read-only, so the requested artifact could not be written directly to `/Users/ssyram/workspace/ai-tools/pi-mono/.pi-subagents/artifacts/outputs/48b6c257/my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/challenger-spec.md`; this report is the complete artifact content.
</answer>

<next_steps>
Prioritize C-001 with a terminal-bottom overflow regression, then reconcile the `native-commit-gate` and terminal-support specifications. Add crash-recovery, IME, and snapshot-interruption tests before treating the Sound/Complete claims as proven.
</next_steps>
</results>