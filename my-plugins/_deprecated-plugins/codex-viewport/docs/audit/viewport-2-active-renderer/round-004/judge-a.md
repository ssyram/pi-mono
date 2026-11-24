# QPDI Tribunal Round 004-A — Judge A

## Inherited decisions

- `docs/design/principles.md` is authoritative intent. Design cannot weaken it implicitly.
- `architecture.md`, `detailed-design.md`, `detail/`, and `proofs/` govern implementation. Tests cannot repair a design-level contradiction.
- Input correctness, single-copy history, native-equivalent idle output, renderer ownership, terminal-state-aligned handoff, and IME safety are hard Sound obligations.
- Optimization is hard: production-dead surface must be removed where dominance is verified, but live ABI and handoff fields must remain.
- Round 004-A covers Sound and Optimization. Cross-terminal completeness remains partly reserved for 004-B, but a support claim exceeding evidence is still adjudicable here.
- Pi 0.83 private renderer/lifecycle behavior is the consumer contract for this review.

## Personally verified evidence

- Read the complete round plan, Challenger A, Prover A, and Counter A.
- Read the governing principles, architecture, detailed design, known state, lifecycle/failure design, verification plan, and SCCO proof.
- Inspected all implementation and tests implicated by Counter §7.
- Installed packages are `@earendil-works/pi-coding-agent 0.83.0` and `@earendil-works/pi-tui 0.83.0`.
- Repository package manifests remain `0.80.10`; therefore local TypeScript checking is not itself proof of Pi 0.83 ABI compatibility. The installed 0.83 sources were inspected directly.
- Installed Pi 0.83:
  - Processes terminal input listeners in `Set` insertion order and stops at `{ consume: true }`.
  - Calls `fullRender(true)` for width changes and non-Termux height changes; its comment says the latter keeps the visible viewport aligned.
  - Uses both `clearOnShrink` and `logDirectory` at runtime.
  - Routes extension warning notifications through `showWarning()`, which appends persistent `Spacer` and `Text` children to `chatContainer`.
  - Has direct `ui.stop()` paths for interactive quit, suspend, and external editor; interactive quit stops before extension disposal.
- Verification:
  - `node --import tsx --test my-plugins/codex-viewport/*.test.ts`: **59 tests, 12 suites, 59 pass, 0 fail**.
  - `tsc -p my-plugins/codex-viewport/tsconfig.json --noEmit`: pass.
  - `git diff --check -- my-plugins/codex-viewport`: pass.
  - Vitest was not treated as authoritative because these files register through `node:test`.
- Narrow DSR probe using the actual `queryTerminalCursor()`:
  - Rejected at 26 ms.
  - Bare `ESC` supplied at 28 ms returned `{ consume: true }`.
  - Replay occurred at 1029 ms.
- Narrow dirty width-gate stop probe using actual runtime code:
  - Before stop: phase `width-recapture-gate`, `nativeRenders=1`, native baseline still contained `before-width`.
  - After stop: phase unchanged, `nativeRenders=1`, `stopCalls=1`, patch removed, and `after-width-before-stop` remained absent.
- Real tmux `20x24 → 20x12` resize:
  - Full bottom-anchored content changed cursor row `23 → 11` and visible lines `L00..L23 → L12..L23`.
  - Short top-anchored content retained cursor row `5` and visible lines `A00..A05`.
  - Height relocation is therefore conditional but real.

## Diagnosis

The normal managed-rendering algorithm has substantial valid evidence: source-order finality, bounded live-region growth, top-only history insertion, editor/footer priority, single-write acceptance, and strict native handoff comparison all pass their modeled tests.

Round 004-A nevertheless fails Sound for three independent reasons:

1. DSR acquisition temporarily owns ambiguous raw input without a provenance channel.
2. Height rebase assumes absolute physical rows survive terminal resize, which is false in a reachable bottom-anchored state.
3. Direct `TUI.stop()` during a dirty width-recapture gate discards the native catch-up required to make the component tree current.

Two additional policy conflicts remain: persistent failure warnings violate literal native-visible equivalence, and the terminal allowlist exceeds verified terminal/IME evidence.

Optimization also fails. Several production symbols have empty consumer sets, but Challenger’s aggregate scope incorrectly included live `logDirectory` validation and the live renderer-state displacement handoff guard.

## Structural-locality rulings

- Implementation tests cannot defend the height policy: “height stays managed” is an explicit design decision, and that design lacks a terminal-state re-attestation argument.
- The design cannot defend persistent warning rows against the literal principles. Only a principles revision can authorize that exception.
- Passing DSR tests cannot prove the design claim that the filter “only consumes complete cursor reports”; the implementation deliberately consumes incomplete prefixes.
- Native ownership is not native-visible equivalence. A single native renderer can own a component tree already modified by plugin warning rows.
- A native render call is not necessarily a full redraw. The valid width claim is “one mandatory width-triggered full redraw,” not “only one native render.”

# Normalized candidate verdicts

## Sound and proof candidates

| Candidate | Verdict and severity | Exact facts personally checked | Violated contract; root layer; same-root scope | Disposition |
|---|---|---|---|---|
| **A-S1 — DSR/input collision** | **Modified — MAJOR** | `DSR_PREFIX` accepts bare `ESC`, `ESC[`, and incomplete numeric CSI prefixes. Timeout/write failure retains the filter for 1000 ms. Actual probe consumed `ESC` at 28 ms and replayed it at 1029 ms. Complete CPR-shaped input has no request correlation or user-input provenance. Earlier Pi listeners can observe or consume the response first. Ordinary text and completed non-CPR sequences remain forwarded. | Violates stable input and the design statement that only DSR is consumed. Root **D / I / terminal policy**. Same root covers entry and width re-entry queries, late filtering, replay, listener ordering, CPR-shaped user input, and related tests/docs. | **User-decision gate.** The problem is bounded to query windows, but input policy versus late-CPR safety is not decided by existing principles/design. |
| **P-4.1 — Apple Terminal/IME safety** | **Modified — MAJOR proof gap, not a reproduced IME defect** | Principles promise composition/candidate/commit safety. Managed rendering emits CUP, line-clear, cursor-visibility, and DSR-filter activity. No Apple Terminal composition, candidate, commit, or cancel test exists; the verification plan explicitly says global smoke does not prove it. | Universal IME protection is unsupported for an allowlisted terminal. Root **Test / terminal policy**, with a design support-scope dependency. Same root includes Apple Terminal, direct IME tests, and support claims. | **User-decision gate:** verify before claiming support, narrow support, or explicitly accept an unverified terminal risk. |
| **A-S2 — height rebase physical provenance** | **Modified — MAJOR** | `rebaseManagedHeight()` only clamps logical `top`/`bottom`. `ManagedRenderer` then continues absolute-row diffing without DSR, native render, or buffer re-attestation. Real tmux shrink relocated `L12..L23` to screen rows `0..11`; short content did not relocate. Installed Pi 0.83 uses `fullRender(true)` for non-Termux height changes to preserve alignment. | Violates terminal-real-state alignment, single-owner correctness, and native-equivalent recovery. Root **D / I / Test**. Same root covers all height changes during managed epochs, provenance/state diffing, height tests, Termux exceptions, and resize documentation. | **User-decision gate.** Existing design must change; implementation-only arithmetic cannot fix it. |
| **P-4.2 — height test proves soundness** | **Sustained — MAJOR proof failure; subsumed by A-S2** | `resize-epoch.test.ts` mutates only fake `terminal.rows`. The fixture has no scrollback, viewport anchoring, or physical relocation model. The real tmux probe demonstrates the missing behavior. | The verification claim exceeds the test model. Root **D / I / Test**. Same-root scope is identical to A-S2. | **User-decision gate**, shared with A-S2. The current test may remain as an arithmetic unit test but cannot count as terminal-level proof. |
| **A-S3 — dirty width-gate direct stop** | **Sustained — MAJOR** | Gate renders set `gateRenderPending`. Normal gate return calls saved native `doRender()` when dirty. Patched `stop()` instead calls `dispose(false)` whenever `nativeFrameCurrent` is true. Actual probe left `previousLines` stale and performed no second native render. Pi direct-stop paths are reachable before extension disposal. | Violates “every path into idle obtains the same native static result” and gate-state alignment. Root **I / lifecycle**. Same root covers interactive quit, suspend, external editor, direct TUI stop, and any gate exit bypassing `returnToNativeFromWidthGate()`. | **Non-decisional direct fix.** Perform pending native catch-up before original stop, preserve method restoration even if catch-up fails, and add a regression for dirty gate plus direct stop. |
| **P-4.3 — failure notifications alter native-visible output** | **Sustained — MAJOR contract conflict** | Failure paths call `ctx.ui.notify(..., "warning")`. Installed Pi 0.83 routes warnings to `showWarning()`, which appends persistent chat components. The test fixture only stores strings in an array and therefore misses this behavior. Native ownership may be restored, but subsequent native output includes plugin-added rows. | Violates literal 100% idle/native-visible equivalence. Root **Q / D / I**. Same root covers all entry, render, handoff, and recapture failure notifications. | **User-decision gate.** Either remove persistent diagnostics, obtain a non-chat transient/log channel, or revise principles to authorize warning-row deviation. |
| **P-4.4 — “no second redraw”** | **Modified — MINOR documentation inconsistency** | Dirty recapture failure performs another saved native `doRender()`; the regression expects `nativeRenders=2` and `nativeFullRedraws=1`. Architecture and lifecycle detail narrowly say no second **full redraw**; `known-state.md` uses broader wording equivalent to “not redrawn twice.” Independent Pi conditions such as height change or `clearOnShrink` can make a catch-up render full. | Violates documentation/implementation precision, not the one-mandatory-width-reflow behavior. Root **D mirror / I / upstream ABI**. Same root covers width failure, cancellation, dirty catch-up, and all redraw terminology. | **Non-decisional direct fix.** State: “one mandatory width-triggered full redraw; a dirty gate may require a later native catch-up render, normally incremental but subject to Pi’s own full-render conditions.” |
| **P-4.5 — broad terminal allowlist** | **Modified — MAJOR support-proof gap** | `detectSupportedTerminal()` accepts tmux, Apple Terminal, iTerm2, WezTerm, kitty, xterm/screen/tmux/rxvt/vt100/ansi prefixes. Direct evidence is tmux/xterm-oriented; known state explicitly lists unfinished Apple IME, iTerm2, Kitty, WezTerm, and Zellij work. This does not prove those terminals fail. | Support policy exceeds verified behavioral premises. Root **Test / terminal policy**, with a design support-scope dependency. Same root includes DSR, resize, scrollback, sync-output, cursor, and IME semantics for every allowlisted family. | **User-decision gate:** complete the matrix, narrow detection, or explicitly accept documented unverified support risk. |

## Optimization candidates

| Candidate | Verdict and severity | Exact facts personally checked | Contract, root, and same-root scope | Disposition |
|---|---|---|---|---|
| **A-O1 aggregate** | **Modified — MINOR** | The aggregate mixes genuinely unread production fields, empty-consumer functions, test-only APIs, a live runtime ABI validation, and a live handoff guard. | Strict Optimization. Root **I / ABI mirror**. Scope must be split symbol by symbol. | **Mixed:** direct deletions below; `logDirectory` and live renderer displacement are false problems. |
| **O6-same-area** | **Sustained — MINOR** | `sameViewportArea()` has only its definition and export. | Root **I**; same root is `inline-viewport-area.ts` and its imports. | **Non-decisional direct fix:** delete. Dominance is verified because production behavior and tests have no consumer. |
| **O6-render-items** | **Sustained — MINOR** | `renderItemComponents()` has only its definition and export. | Root **I**; same root is `component-ledger-reconciler.ts` and imports. | **Non-decisional direct fix:** delete. |
| **O6-entry-expansion** | **Sustained — MINOR** | `NativeEntryBaseline.expansion` is constructed as a no-op and never read. The live growth path instead reads `growth.expansion.bytes`. | Root **I**; same root is baseline construction/types, not live-region growth. | **Non-decisional direct fix:** remove the baseline field and no-op construction. |
| **O6-entry-origin** | **Sustained — MINOR** | `NativeEntryBaseline.originalOriginRow` is assigned from `originRow` and never read. | Root **I**; same root is baseline type/construction. | **Non-decisional direct fix:** remove. |
| **A-O1-entry-displaced** | **Sustained — MINOR, baseline field only** | Baseline `displacedEntryRows` is always initialized to zero and never read. It is distinct from renderer-state `displacedEntryRows`. | Root **I**; same root is `NativeEntryBaseline` only. | **Non-decisional direct fix:** remove the baseline field. |
| **O6-expanded-viewport** | **Sustained — MINOR, test-only API** | `expandedViewport()` is consumed only by `inline-entry.test.ts`; production growth uses `planLiveRegionGrowth()`. | Root **I / Test**; same root includes the isolated helper test. | **Non-decisional direct fix:** delete the production API and retarget any uniquely valuable invariant assertion to the live growth path. Do not represent test-only reachability as production liveness. |
| **O6-poisoned-phase** | **Sustained — MINOR** | `"poisoned-recovery"` appears only in the `RuntimePhase` union; no producer or branch exists. | Root **I / D mirror**; same root includes phase documentation and exhaustive switches. | **Non-decisional direct fix:** remove from code and design mirrors. |
| **O6-clear-on-shrink** | **Sustained — MINOR, plugin declaration only** | Plugin `TuiInternals.clearOnShrink` is never read or validated. Installed Pi’s own field is live, but that does not require the plugin interface to declare it. | Root **I / upstream ABI mirror**; scope excludes upstream Pi implementation. | **Non-decisional direct fix:** remove only the unused plugin type member and fixture assignment if no longer required. |
| **O6-log-directory** | **Rejected — NONE** | Plugin `tuiInternals()` validates `logDirectory` as a runtime ABI sentinel. Installed Pi 0.83 reads it for `pi-debug.log` and `pi-crash.log`. | No dead-surface contract violation is established. Root allegation **I / ABI** is false as stated. | **False problem.** Whether the sentinel is overly strict is a separate ABI-policy question, not dead-code deletion. |
| **O6-mark-rendered** | **Sustained — MINOR, test-only API** | `TranscriptLedger.markRendered()` is called only by `transcript-ledger.test.ts`; no production event invokes it. | Root **I / Test**; same root includes its isolated mutation test. | **Non-decisional direct fix:** remove the production method and test-only path; retain committed-mutation coverage through the actual renderer/reconciler path if that invariant is still required. |
| **live-displaced-control** | **Rejected — NONE** | `ManagedRenderer.state()` produces runtime `displacedEntryRows`; `prepareNativeHandoff()` consumes it to reject seamless handoff while native-tail ownership may remain. `native-handoff.test.ts` behaviorally covers the guard. | The field enforces the handoff provenance contract. Root allegation **I** is false. | **False problem. Protect this live handoff field.** |

## Optimization-alternative rulings

| Alternative | Verdict | Ruling |
|---|---|---|
| **O-ALT-1 — reuse native height redraw plus width-style re-entry** | **Modified** | It dominates the unsound current height arithmetic on correctness and reuses existing machinery, but costs a visible reflow/scrollback rebuild and revises an explicit design promise. It is a real user-decision option, not an automatic implementation cleanup. |
| **O-ALT-2 — DSR-only height re-attestation** | **Rejected** | Cursor position alone does not attest every stable/live row’s provenance. |
| **O-ALT-3 — reuse Pi logical baseline fields** | **Rejected** | `previousViewportTop` and cursor fields describe Pi’s model, not independently verified terminal physical ownership after relocation. |
| **O-ALT-4 — upstream physical-origin/query-response API** | **Modified** | This would dominate extension-level raw-input filtering, but the installed/current API does not exist. It is a recommended upstream direction, not a current local fix. |
| **O-ALT-5 — component-only rendering** | **Rejected** | It cannot enforce top-history insertion, single-copy finalization, or live-tail ownership. |
| **O-ALT-6 — full-screen takeover** | **Rejected** | It violates the principles against reimplementing the full TUI. |
| **O-ALT-7 — custom-renderer reliance** | **Rejected for now** | No immutable component/output contract proves it can preserve the required physical invariants. |
| **O-ALT-8 — delete dead surface** | **Modified and sustained symbol-by-symbol** | It strictly dominates only for the verified dead/test-only symbols above. It does not authorize deletion of `logDirectory` validation or live renderer displacement provenance. |

# Material Prover-claim adjudication

| Material claim | Verdict and severity | Checked facts, contract, root, scope, and disposition |
|---|---|---|
| Stable prefix is not repeatedly cleared during normal streaming | **Sustained — INFO, bounded scope** | Fake-TUI tests show stable rows above the first unfinished component avoid `EL2`; normal tmux smoke is consistent. Accepted for unchanged geometry in the tested managed path. It does not cover the height-provenance defect. Root **I/Test**; accepted boundary. |
| Ledger commits only the maximal finalized source-order prefix | **Sustained — INFO** | `prepareCommit()`, prepared-range revision checks, reorder logic, and generated completion permutations were inspected and pass. Root **I**; accepted boundary. |
| Demand-driven geometry is sufficient physical geometry | **Modified — MAJOR** | Downward-first/upward-on-overflow arithmetic is internally correct, but physical sufficiency fails after a relocating height resize. Root **D/I/Test**; user gate shared with A-S2. |
| History insertion and render acceptance are single-copy transactions | **Sustained — INFO within declared write model** | History bytes use a top scroll region; ordinary frame diff uses absolute CUP/EL, and logical previews accept only after successful write. Partial terminal writes remain a documented non-rollback boundary. Root **D/I**; accepted boundary. |
| Native handoff requires visible bytes, cursor, dimensions, and displacement provenance | **Sustained — INFO** | `prepareNativeHandoff()` checks these conditions and consumes live displacement state before priming Pi’s baseline. This is **visible/physical equivalence**, not mere ownership equivalence. Root **D/I**; accepted boundary for the explicit handoff path. |
| Width re-entry uses one native redraw then a second DSR | **Modified — MINOR wording** | It uses one mandatory width-triggered full redraw and a second DSR. A dirty gate can add a native catch-up render. Root **D mirror/I**; direct documentation fix. |
| All lifecycle paths return to the same native static result | **Rejected — MAJOR** | Dirty direct stop in the width gate reproduces stale native state. Root **I/lifecycle**; direct fix A-S3. |
| Plugin does not mutate AI/tool/session behavior | **Sustained — INFO for inspected source** | Event handlers read message/tool identifiers and update display-owned runtime state; no provider, tool result, message, session, or persistence mutation was found. The isolation test preserves the tested message JSON and does not abort. Warning rows are a display-equivalence violation, not an AI/session mutation. Root **I/Test**; accepted boundary subject to 004-B completeness review. |
| Current terminal support is Sound | **Rejected — MAJOR proof gap** | Known state explicitly leaves Apple IME and several allowlisted terminals unverified. Root **Test/terminal policy**; user gate. |
| Current module/surface set is minimal | **Modified — MINOR** | Core bounded takeover remains better aligned than component-only or full-screen takeover, but verified dead/test-only surfaces defeat strict Optimization. Root **I**; direct cleanup plus post-fix audit. |

## Drift and contradiction check

- **Height:** architecture says height remains managed, while Pi 0.83 deliberately performs native full rendering to preserve viewport alignment. Tests silently substitute integer arithmetic for terminal semantics.
- **Width-gate stop:** architecture acknowledges component-tree changes during the gate but later equates “last writer was native” with “native frame is current.” Those are not equivalent after a pending render.
- **Redraw wording:** “native render” and “full redraw” were used interchangeably. Only the latter is limited to one mandatory width-triggered event.
- **Visible equivalence:** failure recovery restores native ownership, but persistent warning components still alter later native-visible content.
- **Terminal support:** detection acts like a support allowlist while known state describes several accepted values as unverified.
- **Optimization scope:** baseline and renderer-state displacement fields were conflated; upstream field liveness was conflated with whether the plugin needs a local interface member.
- **Version assurance:** local types are 0.80.10 while the reviewed runtime is 0.83.0. Direct installed-source inspection reduces, but does not eliminate, the need for continued 0.83 runtime smoke coverage.

# 1. Ordered non-decisional fix list

1. Fix dirty `width-recapture-gate` direct `TUI.stop()`:
   - If `gateRenderPending` and Pi is not already stopped, invoke saved native `doRender()` before original stop.
   - Restore patched methods even if catch-up fails.
   - Add a regression asserting dirty gated content reaches `previousLines`, native render count advances, original stop runs, and methods are restored.
2. Correct width-recapture wording across `known-state.md`, lifecycle detail, architecture mirrors, and tests:
   - One mandatory width-triggered full redraw.
   - Optional dirty native catch-up render.
   - Catch-up is normally incremental but remains subject to Pi’s independent full-render conditions.
3. Delete verified production-dead surface:
   - `sameViewportArea()`
   - `renderItemComponents()`
   - `NativeEntryBaseline.expansion`
   - `NativeEntryBaseline.originalOriginRow`
   - Baseline-only `displacedEntryRows`
   - `"poisoned-recovery"`
   - Plugin-only `TuiInternals.clearOnShrink`
4. Remove test-only production APIs:
   - `expandedViewport()`
   - `TranscriptLedger.markRendered()`
   - Retarget uniquely valuable assertions to live production paths; do not delete behavior coverage merely to reduce line count.
5. Preserve:
   - `TuiInternals.logDirectory` validation pending a separate ABI-sentinel policy review.
   - `ManagedRendererState.displacedEntryRows` and its native-handoff regression.
6. Rerun the 59-test suite, TypeScript, `git diff --check`, and a focused Pi 0.83 lifecycle smoke after fixes.

**Suggested execution prompt:** Implement only items 1–6 above. Do not decide DSR, height, diagnostics, or terminal-support policy. Do not remove `logDirectory` validation or `ManagedRendererState.displacedEntryRows`. Add the dirty direct-stop regression and preserve all existing behavior tests.

# 2. Batched user-decision items

## D1 — Height transition policy

**Exact trigger:** terminal height changes while phase is `active-managed`, especially when the terminal relocates a bottom-anchored viewport.

**Real options:**

1. Use Pi native `fullRender(true)` followed by DSR recapture and a new managed epoch.
2. Keep managed height only for explicitly verified non-relocating environments such as a separately proven Termux policy; use native re-entry elsewhere.
3. Build terminal-specific physical-row re-attestation/mapping and complete a terminal matrix before enabling it.
4. Keep the present arithmetic policy and explicitly weaken terminal-alignment/idle-equivalence guarantees.

**Recommendation:** Option 1. It reuses existing width-epoch machinery and aligns with Pi 0.83’s own resize contract. Option 4 is not recommended because it revises hard principles.

## D2 — DSR versus input policy

**Exact trigger:** entry or width re-entry sends DSR while user input can arrive or earlier Pi listeners exist.

**Real options:**

1. Accept the bounded timeout-plus-late-filter collision and document it as a principles exception.
2. Obtain an upstream Pi raw query-response/physical-origin API that runs before ordinary input listeners.
3. Query only at a defined no-input-activity safe point and fail open if that condition cannot be established.
4. Disable managed entry on environments where safe DSR correlation cannot be guaranteed.

**Recommendation:** Pursue option 2 as the sound long-term design; use option 3 or 4 as the immediate conservative policy. Do not silently select option 1 because input correctness is explicitly prioritized.

## D3 — Failure diagnostics versus literal visible equivalence

**Exact trigger:** any plugin failure path calling `ctx.ui.notify(..., "warning")`.

**Real options:**

1. Remove persistent UI warnings and rely on logging/non-visible diagnostics.
2. Obtain/use a transient non-chat diagnostic channel.
3. Revise principles to permit persistent plugin warning rows after failures.

**Recommendation:** Option 1 immediately, or option 2 when available. Option 3 is a real principles change and must be explicit.

## D4 — Terminal allowlist and IME support

**Exact trigger:** `detectSupportedTerminal()` accepts a terminal family without direct DSR, resize, cursor, scrollback, synchronized-output, and—where applicable—IME evidence.

**Real options:**

1. Narrow enabled support to the verified tmux/xterm-oriented envelope and expand only after tests.
2. Complete Apple Terminal, iTerm2, Kitty, WezTerm, and relevant multiplexer matrices before claiming support.
3. Keep the broad allowlist as an explicitly accepted unverified-risk policy.

**Recommendation:** Option 1 now, with option 2 as the path to broader support. Apple Terminal should not carry an IME-safety claim before direct composition/candidate/commit/cancel verification.

# 3. S and O status

- **S — Sound: FAILED / NOT DONE.**
  - Blocking findings: A-S1, A-S2/P-4.2, A-S3, P-4.3, and terminal/IME support gaps.
  - A-S3 is directly fixable; the others require the batched user decisions above.
- **O — Optimization: FAILED / NOT DONE.**
  - Verified dead and test-only production surfaces remain.
  - Core takeover architecture is not displaced by the rejected alternatives.
  - Height native re-entry and an upstream origin API remain valid decision-gated optimization directions.

# 4. Convergence

**Round 004-A did not converge.** It requires non-decisional fixes, explicit decisions for four policy groups, and a post-fix 004-A re-audit. Round 004-B should begin only after the repaired lifecycle/dead-surface state and chosen policy changes are incorporated and reverified.