# Counter-challenge Round 005 — F15/F16

## Review

- **Correct:** The Round 005 audit scope is the 52 non-test TypeScript files stated in `round-005/plan.md:5`. A current filesystem count is 68 top-level TypeScript files: 52 non-test files and 16 `*.test.ts` files. The requested root `/plan.md` does not exist; root `progress.md:1-10` contains no substantive plan or findings, so the round-local plan is the available authority.
- **Correct:** `node --test --import tsx my-plugins/codex-viewport/*.test.ts` passes: 65 tests, 16 suites, 0 failures, 0 skipped.
- **Blocker:** F16 remains a specification/evidence-consistency blocker to a Round 005 `PROVEN` result under the convergence gate in `round-005/plan.md:39-41`.

## F15 — narrowed verdicts

### Blanket “dead/duplicated transaction machinery” claim — REJECTED

The blanket claim combines four mechanisms with materially different reachability:

1. **Prepared ledger commits — REJECTED as dead machinery.** `ManagedRenderer.render()` prepares the maximal finalized prefix, writes the terminal plan, cancels on write failure, and accepts only after a successful write (`managed-renderer.ts:72-147`). The ledger enforces prepared-object identity, ledger revision, item-range identity, and no reorder while prepared (`transcript-ledger.ts:97-173`). Direct coverage exists for prepare/commit, cancellation without frontier advancement, reorder rejection, and generated completion permutations (`transcript-ledger.test.ts:15-31`, `transcript-ledger.test.ts:47-56`, `transcript-ledger.test.ts:76-107`). This is load-bearing transaction and ordering state.

2. **Stable-row attestation data — REJECTED as dead machinery.** Production entry derives `initialStableRows` and `stableRowsKnown` (`native-entry-baseline.ts:42-88`). `ManagedRenderer` constructs and reads `StableScreenRows`, exposes its rows/knowledge, and carries displaced-row state (`managed-renderer.ts:36-66`, `managed-renderer.ts:88-99`, `managed-renderer.ts:181-183`). Native handoff rejects unknown/incomplete stable rows and unsafe displaced entry rows (`native-handoff.ts:15-54`); the displaced-row rejection is directly tested (`native-handoff.test.ts:42-53`). The attestation value is load-bearing even though part of its class API is not.

3. **Native commit — REJECTED as dead machinery.** A prepared render produces a `native-commit` outcome (`managed-renderer.ts:126`). The runtime patch consumes it, validates handoff, invokes one saved native `doRender`, advances the frontier only after success, and routes rejection/failure to recovery (`native-commit.ts:10-24`, `runtime-patch.ts:171-197`). Tests cover successful multi-line transition, exactly one native render, native-render failure, method restoration, reentrancy, and terminal-write failure (`demand-driven-runtime.test.ts:65-76`, `managed-runtime.test.ts:73-107`, `managed-runtime.test.ts:160-175`). This is load-bearing renderer ownership and commit ordering.

4. **The full viewport-expansion/history mechanism — DISPUTED.** Its nonzero branch is unreachable, but the zero-valued result remains wired into render planning. Therefore only the nonzero behavior, not every expansion-shaped value or consumer, is presently shown dead.

### Nonzero viewport expansion — CONFIRMED at current call-graph scope

`buildViewportExpansion()` emits scroll-region/CRLF history bytes only when `nextTop < currentTop` (`viewport-expansion.ts:6-16`). Its sole production caller always passes `area.top` for both arguments (`live-region-growth.ts:9-16`). Its only test-level growth caller likewise observes empty bytes and zero displacement (`inline-entry.test.ts:16-21`). The broader runtime tests assert downward growth followed by cropping and reject manual scroll-region/CRLF history output.

Thus replacing the current production expansion result with `{ bytes: "", displacedStableRows: 0 }` is observationally equivalent for every current `planLiveRegionGrowth()` call. This confirms unreachable **nonzero** behavior only. It does not by itself prove that the expansion field, displacement accounting, or stable-row handoff inputs can all be erased.

### `StableScreenRows` preview/revision API — CONFIRMED at repository-local call-graph scope

`StableScreenRows.previewAppend()`, `StableScreenRows.accept()`, the private `revision`, and exported `StableScreenPreview` are defined in `stable-screen-rows.ts:1-34`. Repository-wide TypeScript call-site inspection found no invocation of `previewAppend()` or `accept()` and no test for stale-preview rejection. Production uses only construction, `rows()`, and `known` (`managed-renderer.ts:13`, `managed-renderer.ts:36-66`, `managed-renderer.ts:88-99`).

The revision API is therefore unused repository-local machinery. The class and its stable-row bytes/knowledge are not unused. Because the preview type and class are exported from their module, removal must either establish that this module has no supported external consumers or intentionally treat the change as an API contraction.

## SCC-preserving optimization burden

Optimization is admissible only if it preserves the same safety, correctness, and convergence obligations:

- **For nonzero viewport expansion removal:** preserve current downward growth, terminal-bottom cropping, no plugin-owned history insertion, no CRLF/scroll-region output, unchanged stable rows, and unchanged handoff values for every height rebase and growth path. First resolve the conflicting upward-growth specification; code-call-graph equivalence is not equivalence to a spec that still requires upward growth.
- **For stable preview/revision removal:** retain `capacity` validation, stable-row truncation semantics, `known` semantics, `rows()` contents, height/growth reconstruction behavior, and the exact `{ stableRows, stableRowsKnown, displacedEntryRows }` presented to native handoff. Add a focused test proving these outputs across entry, height rebase, downward growth, and handoff. Removing only the uncalled preview/revision members carries a much smaller burden than replacing stable-row attestation.
- **For any prepared-state simplification:** prove maximal source-order prefix selection; prepared ID/revision validity; reorder prohibition; terminal-write-before-frontier-accept ordering; unchanged frontier on write failure/native-render failure; and synchronous render reentrancy. The existing immutable-candidate suggestion does not yet discharge these obligations.
- **For any native-commit simplification or rename:** preserve handoff validation before native render, exactly one saved native render, frontier acceptance only after native success, unchanged frontier on throw, method restoration, recovery/fallback routing, and exclusive renderer ownership. Current tests make these observable requirements, not naming-only concerns.

## F16 — CONFIRMED, with one correction to the prior proposed correction

### Confirmed contradictions

1. **Runtime phase omission.** `RuntimePhase` includes `native-commit-gate` (`runtime-phase.ts:1-9`), and the coordinator enters and handles it across capture, run completion, shutdown, and managed-state classification (`runtime-coordinator.ts:125-172`). The detailed-design phase union omits it (`docs/design/detailed-design.md:45-49`).

2. **Upward/history growth versus implemented crop-only behavior.** Detailed design labels `live-region-growth.ts` “downward-first, upward-on-overflow” and describes upward scroll-region displacement in its Geometry section (`docs/design/detailed-design.md:15`, `docs/design/detailed-design.md:62-73`). Architecture and the audit report retain equivalent upward/history claims. Production never lowers `top`; it grows `bottom` to terminal height and then crops pending content (`live-region-growth.ts:9-16`). README and the implemented D-layer decision instead say no plugin-owned history insertion and terminal-bottom cropping.

3. **Stable/history preview language versus implementation.** Architecture’s single-frame transaction still says protected/history/stable state is previewed and accepted, while the current `StableScreenRows.previewAppend()/accept()` path has no caller. Prepared ledger state is transactional; stable rows are reconstructed after successful rendering. These mechanisms must not be documented as one common preview transaction.

4. **Allowlisted terminals versus verified terminals.** Terminal detection allowlists tmux, Apple Terminal, iTerm, WezTerm, kitty, and common ANSI TERM families (`detect-supported-terminal.ts:1-10`). The evidence record says iTerm2, Kitty, WezTerm, and Zellij validation remains unfinished and Apple Terminal Chinese IME is unverified (`docs/design/known-state.md:79-85`; `docs/audit/viewport-2-active-renderer/audit-report.md:74-83`). Eligibility is not verification.

5. **Snapshot durability overclaim.** README says artifacts are durable after freeze release (`README.md:52-61`). `secureWrite()` uses direct `writeFile` followed by `chmod`, and `latest.json` is overwritten directly after concurrent artifact writes (`snapshot-artifacts.ts`, `secureWrite()` and `writeSnapshotArtifacts()`). There is no temporary-file rename, file sync, or directory sync. Tests establish contents, paths/pointer shape, and permissions, not crash-atomic persistence.

6. **Stale executable-evidence count.** `docs/design/known-state.md` and `docs/audit/viewport-2-active-renderer/audit-report.md` report 59 tests / 12 suites. The current documented command runs 65 tests / 16 suites successfully.

7. **Hard-death and IME proof limits.** README and known-state correctly narrow hard-death recovery to Pi JSONL content persisted at `message_end`, exclude in-flight output/old terminal fragments, and state that the plugin cannot prove the macOS framework IME bug fixed. Any SCCO/global-evidence wording that promotes these to verified guarantees contradicts those explicit limits. SIGKILL/reopen and direct Apple Terminal IME composition/candidate behavior remain unverified, not disproved.

### Prior inventory correction — DISPUTED

The proposed replacement inventory “67 total = 50 production + 17 tests” is not current. Direct counting gives:

- 68 top-level `*.ts` files;
- 52 non-`*.test.ts` files;
- 16 `*.test.ts` files.

Accordingly, Round 005’s “52 non-test TypeScript files” is correct. `inline-entry.ts` does not exist; `managed-entry.ts` is the production entry implementation, while `inline-entry.test.ts` is a test. Documentation should state the counting rule explicitly rather than substitute the stale 67/50/17 figures.

## Exact documentation corrections required

1. **`docs/design/detailed-design.md` RuntimePhase:** insert `"native-commit-gate"` and document `active-managed → native-commit-gate → active-managed | active-native-fallback`, plus finish/capture/shutdown exits actually implemented by `RuntimeCoordinator`.
2. **`docs/design/detailed-design.md` module/Geometry text:** change `live-region-growth.ts` from “downward-first, upward-on-overflow growth” to “grow `bottom` downward to terminal height, then crop the oldest pending suffix”; delete the top-scroll-region/history-displacement paragraph.
3. **`docs/design/architecture.md` and `docs/audit/viewport-2-active-renderer/audit-report.md`:** delete claims that capacity pressure lowers `top`, pushes stable rows into history, or has automated upward-demand/in-run-history coverage. Replace them with the tested crop-only/no-stable-row-movement behavior. Do not claim upward growth as proven unless it is reintroduced and tested.
4. **`docs/design/architecture.md` transaction description:** distinguish ledger prepare/commit/cancel from stable-row reconstruction. Remove protected/history/stable “preview and accept” wording unless a live preview transaction is restored.
5. **Terminal support documentation:** publish two separate matrices: `allowlisted by detect-supported-terminal.ts` and `verified by terminal/version/environment/test`. Mark iTerm2, Kitty, WezTerm, Zellij, and Apple Terminal Chinese IME exactly according to existing evidence; do not infer verification from allowlisting.
6. **`README.md` snapshot section:** replace “artifacts are durable” with “artifact writes completed successfully before freeze release.” Explicitly state that writes are neither crash-atomic nor fsync-backed and that `latest.json` can be torn/stale after hard death. Alternatively, implement temp-file write + file sync + atomic rename + directory sync before retaining durability language.
7. **Evidence/inventory sections:** record `68 total / 52 non-test / 16 *.test.ts` and `65 tests / 16 suites` for this revision, together with the exact glob and command. Prefer generated counts or label them revision-specific to prevent recurrence.
8. **Hard-death/IME claims:** retain explicit SIGKILL recovery exclusion and “IME framework fix not proven” language everywhere. Require a SIGTERM/normal-shutdown test for graceful lifecycle claims and direct platform integration evidence before elevating SIGKILL/reopen or IME behavior to verified.
9. **Round 005 convergence status:** keep `PROVEN` false until contradictory spec text is corrected, evidence labels match actual coverage, and the clean-room full re-review required by `round-005/plan.md:39-41` completes.

## Final verdict table

| Candidate | Verdict | Narrow scope |
|---|---|---|
| F15 blanket dead-machinery claim | **REJECTED** | Prepared commits, stable-row attestation, and native commit are production-consumed and tested. |
| F15 nonzero viewport expansion | **CONFIRMED** | Unreachable through all current production callers; zero expansion remains consumed. |
| F15 `StableScreenRows` revision API | **CONFIRMED** | `previewAppend`/`accept`/revision/preview type have no repository-local caller; stable-row data remains load-bearing. |
| F15 broader prepared/native/stable simplification | **DISPUTED** | No SCC-preserving equivalence proof meets the obligations above. |
| F16 spec/evidence contradictions | **CONFIRMED** | Blocker to `PROVEN`; exact corrections listed above. |
| F16 proposed `67 = 50 + 17` inventory correction | **DISPUTED** | Current count is `68 = 52 non-test + 16 *.test.ts`. |
