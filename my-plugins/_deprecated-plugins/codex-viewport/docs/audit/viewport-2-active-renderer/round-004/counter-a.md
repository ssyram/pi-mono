# QPDI Tribunal Round 004-A — Counter

## 1. Inherited decisions and review boundary

The controlling intent is stricter than either side's implementation shorthand:

- Input correctness and process survival outrank absolute zero-redraw (`docs/design/principles.md:9-16`).
- Idle behavior and every transition to idle must yield the same native static result (`docs/design/principles.md:22-25,37-38`).
- Renderer handoff must be aligned to terminal reality (`docs/design/principles.md:28,35`).
- The accepted design keeps height changes in the current managed epoch but gives width changes one Pi native full redraw followed by DSR recapture (`docs/design/architecture.md:100-114`; `docs/audit/viewport-2-active-renderer/decisions.md:15-17`).
- The current width-gate stop rationale is expressly “the screen is already native” (`docs/design/architecture.md:116-120`; `docs/design/detail/lifecycle-failure.md:15-17`).

This Counter treats those as the inherited contract. A change that merely removes unconsumed implementation surface is not decision-gated. Changing height policy, accepted terminal policy, DSR collision policy, or the visibility of intentional diagnostics is decision-gated because each changes an already documented behavior or user-visible tradeoff.

No repository source was edited. The only written file is this tribunal artifact.

## 2. Evidence protocol

### 2.1 Mechanical and installed-source evidence

The installed executable is Pi `0.83.0`:

```text
$ command -v pi
/opt/homebrew/bin/pi
$ pi --version
0.83.0
```

The installed TUI dependency is also `@earendil-works/pi-tui 0.83.0`. Its relevant behavior is cited from:

```text
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/
  node_modules/@earendil-works/pi-tui/dist/tui.js
```

The repository's current local `node_modules/@earendil-works/pi-tui` reports `0.80.10`, so fake/unit evidence alone is not substituted for installed `0.83.0` consumer evidence.

Repository-wide consumer search used:

```bash
grep -R -n --include='*.ts' -E \
  'sameViewportArea|expandedViewport|renderItemComponents|markRendered|poisoned-recovery|originalOriginRow|displacedEntryRows|clearOnShrink|logDirectory' \
  my-plugins/codex-viewport
```

The exact results are normalized in §7.

### 2.2 Executed controls and counterprobes

**C1 — focused repository controls**

```bash
node --test --import tsx \
  my-plugins/codex-viewport/query-terminal-cursor.test.ts \
  my-plugins/codex-viewport/resize-epoch.test.ts \
  my-plugins/codex-viewport/managed-runtime.test.ts \
  my-plugins/codex-viewport/runtime-coordinator.test.ts \
  my-plugins/codex-viewport/runtime-patch.test.ts
```

Result: `31` tests, `5` suites, `31` pass, `0` fail. No test combines dirty width recapture with direct `TUI.stop()`. The height test only mutates fake `terminal.rows` (`resize-epoch.test.ts:22-41`).

**C2 — natural DSR timeout and Escape replay**

A temporary probe imported `queryTerminalCursor`, used a `25 ms` query timeout, allowed it to reject, then sent bare `ESC`. Observed output:

```json
{"rejection":"terminal cursor query timed out","rejectedAt":27,"escapeAt":28,"escapeResult":{"consume":true},"replayed":[{"at":1030,"data":"\u001b"}],"handlerInstalled":false}
```

Thus Escape was consumed immediately after rejection and replayed about `1002 ms` later. The temporary probe was removed.

**C3 — bottom-anchored xterm height shrink**

A temporary `@xterm/headless` probe filled a `20x24` terminal with `L00` through `L23` and resized it to `20x12`. Observed state:

```text
before: baseY=0,  viewportY=0,  cursorY=23, visible=L00..L23
after:  baseY=12, viewportY=12, cursorY=11, visible=L12..L23
```

Old physical rows `12..23` became new visible rows `0..11`. The temporary probe was removed.

**C4 — short top-anchored xterm height shrink**

The same emulator with only `A0..A5` and cursor row `5` preserved `baseY=0`, `viewportY=0`, `cursorY=5`, and visible `A0..A5` when resized `24→12`. This is a counterexample to any universal claim that every height shrink relocates rows.

**C5 — dirty width-gate direct stop**

A temporary probe used `RuntimeCoordinator` and the repository fake TUI. After width redraw, it changed assistant content, invoked gated `doRender()`, then called `tui.stop()` before recapture completed:

```json
{
  "beforeStop": {
    "phase":"width-recapture-gate",
    "nativeRenders":1,
    "previousLines":["header","old","before-width","editor","footer"]
  },
  "afterStop": {
    "phase":"width-recapture-gate",
    "nativeRenders":1,
    "stopCalls":1,
    "previousLines":["header","old","before-width","editor","footer"],
    "ownsDoRender":false
  }
}
```

The dirty text `after-width-before-stop` was not caught up. The temporary probe was removed.

## 3. Challenger findings

### 3.1 A-S1 — DSR timeout replay and listener ordering

**Counter verdict: valid as stated. Decision-gated.**

#### Exact surviving facts

1. `DSR_PREFIX` accepts bare `ESC`, `ESC[`, digits, and semicolon-number prefixes (`query-terminal-cursor.ts:8`). A matching incomplete suffix is buffered and returns `{ consume: true }` when there are no preceding bytes (`query-terminal-cursor.ts:58-63`). Pi itself recognizes Escape as codepoint `27` (`packages/tui/src/keys.ts:301-303`).
2. Natural timeout rejects at the query timeout, then retains the handler for another `1000 ms`; only retained-filter cleanup calls replay (`query-terminal-cursor.ts:24-40`). C2 reproduces the resulting post-rejection Escape delay.
3. The existing cancellation test proves replay on explicit abort (`query-terminal-cursor.test.ts:51-72`), while the timeout test proves consumption of a complete late CPR (`query-terminal-cursor.test.ts:74-91`). It does not test natural-timeout replay of an incomplete prefix.
4. Pi 0.83 extension terminal handlers are registered directly through `ui.addInputListener` (installed `interactive-mode.js:1643-1655,1674-1681`). The TUI stores them in a `Set` and iterates insertion order; `{ consume: true }` returns immediately (installed `pi-tui/dist/tui.js:443-450,550-572`; repository source `packages/tui/src/tui.ts:763-786`). Therefore:
   - an earlier extension listener sees the plugin-generated CPR before this filter;
   - an earlier listener may consume it and force query timeout;
   - later listeners do not see a CPR or a DSR-shaped user sequence consumed by this filter.
5. A complete CPR-shaped input is indistinguishable from the terminal's CPR during the query window. The implementation has no provenance bit capable of resolving that collision (`query-terminal-cursor.ts:43-64`).

#### Challenge to acceptance

Acceptance must not overstate the defect. Ordinary text and completed non-DSR escape sequences are forwarded; adjacent input is preserved (`query-terminal-cursor.test.ts:12-49`). A timeout with no prefix-like user input causes no keyboard delay, and retaining the filter correctly prevents a genuine late CPR from reaching the editor (`query-terminal-cursor.test.ts:74-91`). The defect is a bounded collision window, not general input corruption.

#### Challenge to rejection

The window still violates the explicit priority given to stable input (`docs/design/principles.md:10,26`). With the default `150 ms` timeout, a bare Escape already buffered before timeout can be delayed until roughly `1150 ms` after query start; C2 establishes the same `timeout + ~1000 ms` mechanism. CPR-shaped bytes can be consumed outright. Earlier-listener observability is also real in installed Pi 0.83.

#### Gate

The protocol is unframed: unregistering immediately protects Escape but may deliver a late CPR to user input; retaining the filter protects against late CPR but delays/collides with prefix-like user input. The principles select input correctness as the priority but do not select a late-CPR policy. Judge should not silently choose that terminal-policy tradeoff.

### 3.2 A-S2 — terminal-height physical rebase

**Counter verdict: valid as stated. Decision-gated. Severity MAJOR survives.**

#### Exact surviving facts

1. The plugin computes `nextBottom = min(oldBottom, newHeight)` and clamps `nextTop` geometrically (`managed-height-rebase.ts:3-8`).
2. It then compares and paints by absolute screen row (`screen-frame-diff.ts:7-16`), with no DSR, native redraw, buffer query, or scrollback re-attestation. `ManagedRenderer` only marks stable provenance unknown and continues (`managed-renderer.ts:86-94`).
3. For the challenger's example, `[10,24)` shrunk to height `12` becomes `[10,12)`. C3 demonstrates actual xterm-compatible physics for a bottom-anchored screen: old rows `12..23` become new rows `0..11`. The plugin consequently believes it owns only rows `10..11`, while old managed bytes can remain at rows `0..9` outside its declared area.
4. Pi 0.83 independently treats this relocation as requiring native reflow. It recomputes `prevViewportTop` from the old buffer length (installed `pi-tui/dist/tui.js:980-989`; repository `packages/tui/src/tui.ts:1256-1264`) and, except on Termux, calls `fullRender(true)` “to keep the visible viewport aligned” (installed `tui.js:1065-1077`; repository `packages/tui/src/tui.ts:1344-1357`). `fullRender(true)` emits `2J`, homes, emits `3J`, and rewrites the frame (installed `tui.js:1005-1049`).
5. The automated test merely assigns `.rows` and asserts zero native renders (`resize-epoch.test.ts:22-41`). The fake terminal explicitly has no physical-row relocation model (`test-tui-context.ts:33-120`).

#### Challenge to acceptance

C4 refutes a universal formulation: when content/cursor remains above the removed bottom rows, xterm can preserve absolute placement. Height growth and terminal-specific behavior also need not match C3. Pi's Termux branch deliberately skips the native height full redraw (`packages/tui/src/tui.ts:1351-1357`). The established defect is conditional on physical relocation, not proof that every height transition is wrong.

#### Challenge to rejection

The conditional is enough to defeat Sound. C3 supplies an actual emulator trace for exactly the bottom-anchored class the managed viewport reaches. The design's statement that height remains managed (`docs/design/architecture.md:102`) assumes absolute-row identity survives resize; installed Pi's contrary branch and C3 show that assumption is false for an accepted xterm path. Arithmetic coverage cannot attest terminal physics.

#### Gate

A sound repair may fail open to native redraw/re-entry, introduce terminal-specific physical recapture, or narrow supported resize behavior. Native redraw/re-entry revises the documented height policy and introduces a visible clear/scrollback tradeoff. That design choice is user-gated, not a cleanup detail.

### 3.3 A-S3 — dirty width-gate `TUI.stop()`

**Counter verdict: valid as stated. Not decision-gated. Severity MAJOR survives for lifecycle correctness.**

#### Exact surviving facts

1. A render while `renderer` is absent sets `gateRenderPending = true` (`runtime-patch.ts:150-155`).
2. Width change first invokes native `doRender`, sets `nativeFrameCurrent = true`, and begins recapture (`runtime-patch.ts:155-175`).
3. Normal width-gate return restores methods and performs a saved native `doRender()` when dirty (`runtime-patch.ts:109-114`).
4. Patched `stop()` instead takes `dispose(false)` whenever `nativeFrameCurrent` is true (`runtime-patch.ts:122-128`). `dispose(false)` restores methods but does not inspect `gateRenderPending` (`runtime-patch.ts:73-81`).
5. C5 reproduces the stale native frame and missing catch-up. Existing stop tests cover entry/managed stop, not dirty width-gate stop (`runtime-patch.test.ts:23-40`; `managed-runtime.test.ts:132-149`). Existing width cancellation lacks a dirty update and direct stop (`resize-epoch.test.ts:114-125`).
6. This state is reachable from installed Pi lifecycle paths. Interactive quit stops before extension disposal (installed `interactive-mode.js:2899-2906`), while Ctrl+Z and external editor call `ui.stop()` directly (installed `interactive-mode.js:3002-3032,3146-3162`).

#### Challenge to acceptance

Not every stop leaves a permanent stale result. If the gate is clean, the width redraw is current. Ctrl+Z and external-editor return paths call `ui.start()` followed by forced `requestRender(true)`, so they catch up after resume (`interactive-mode.js:3017-3020,3155-3162`). Signal shutdown disposes extensions before stop and therefore normally reaches the coordinator's width-gate return path (`interactive-mode.js:2877-2895`; `runtime-coordinator.ts:117-150`).

#### Challenge to rejection

Interactive quit has the opposite ordering, and C5 proves direct stop drops dirty catch-up before original methods are restored. The principles require all paths to the same native static result, not merely eventual recovery on resumable paths (`docs/design/principles.md:22-23,37-38`). No new product decision is needed: the already implemented dirty catch-up rule must be preserved by the stop path.

### 3.4 A-O1 — dead/unused surface

**Counter verdict: valid but wrong scope as an aggregate. Not decision-gated except the `logDirectory` ABI policy.**

A-O1 mixes genuinely dead plugin fields, test-only APIs, an unnecessary-looking but live ABI check, and a same-named live handoff field. It cannot be accepted or rejected as one undifferentiated claim.

| Symbol | Mechanical result | Counter verdict |
|---|---|---|
| `sameViewportArea()` | Definition/export only at `inline-viewport-area.ts:22-31`; repository search found no caller. | Valid as stated: dead production helper. |
| `renderItemComponents()` | Definition/export only at `component-ledger-reconciler.ts:109-113`; no caller. | Valid as stated: dead production helper. |
| `expandedViewport()` | Called only by `inline-entry.test.ts:44-45`; no production caller. | Valid as stated with scope: test-only API. |
| `TranscriptLedger.markRendered()` | Called only by `transcript-ledger.test.ts:76`; no production caller (`transcript-ledger.ts:70-75`). | Valid as stated with scope: test-only API. |
| `RuntimePhase."poisoned-recovery"` | One hit, its union declaration at `runtime-phase.ts:8`; no producer, comparison, or transition. | Valid as stated: dead phase member. |
| `NativeEntryBaseline.expansion` | Constructed as a no-op `buildViewportExpansion(naturalTop, naturalTop)` at `native-entry-baseline.ts:91`; never read. `growth.expansion` at `managed-renderer.ts:129` is a different object. | Valid as stated: dead baseline field. |
| `NativeEntryBaseline.originalOriginRow` | Assigned at `native-entry-baseline.ts:96`; no read. | Valid as stated: dead baseline field. |
| `NativeEntryBaseline.displacedEntryRows` | Assigned `0` at `native-entry-baseline.ts:95`; `ManagedRenderer` initializes its own `displacedRows = 0` and never reads the baseline field (`managed-renderer.ts:43,51-67`). | Valid as stated only for the baseline field. |
| `ManagedRendererState.displacedEntryRows` | Produced at `managed-renderer.ts:208` and consumed as a native-handoff safety predicate at `native-handoff.ts:21-23`. | False if A-O1 is read as claiming the symbol globally is dead. This distinct field is live. |
| `TuiInternals.clearOnShrink` | Plugin interface/test-fixture hits only (`tui-internals.ts:29`; `test-tui-context.ts:48`); plugin neither reads nor validates it. Installed Pi itself reads its own field at installed `tui.js:1079-1085`. | Valid as plugin-owned type cleanup; false if scoped to upstream Pi. |
| `TuiInternals.logDirectory` | Runtime validation at `tui-internals.ts:47`; installed Pi reads it to construct `pi-debug.log` at installed `tui.js:1050-1057`. | False as an “unread/dead” claim. It is a live plugin ABI precondition and upstream field. Whether it is a necessary ABI sentinel is unproven. |

#### Challenge to acceptance

Deleting `logDirectory` validation changes which TUI shapes pass preflight; that is behavior, not strict dead-code deletion. Also, the live `ManagedRendererState.displacedEntryRows` must not be confused with the dead baseline field of the same name: native handoff uses it to reject unsafe seamless transfer (`native-handoff.ts:21-23`; `native-handoff.test.ts:55-67`).

#### Challenge to rejection

The definition/call-site results for the other helpers and fields are conclusive within the repository. Their deletion does not alter a production call path. Test-only methods are not production consumers merely because their self-tests execute.

## 4. Failed/unverified Prover obligations

### 4.1 Prover §4.1 — Apple Terminal / complex IME safety

**Counter verdict: valid but wrong scope if treated as a confirmed defect; it is an unresolved verification obligation. Decision-gated with terminal policy.**

- The principle is explicit (`docs/design/principles.md:26`).
- Managed rendering emits absolute CUP/line-clear and cursor visibility changes (`screen-frame-diff.ts:7-16`; `cursor-placement.ts:4-8`) while DSR temporarily filters raw input (`query-terminal-cursor.ts:43-64`). These are mechanisms capable of affecting candidate-window anchoring or commit/cancel input.
- The verification record explicitly says direct Apple Terminal composition/candidate/commit/cancel is not completed (`docs/design/detail/verification-plan.md:68-75`; `docs/design/known-state.md:71-77`). No repository test simulates an OS IME candidate window.

**Against acceptance:** absence of the direct test does not prove IME breakage. OS IME composition may remain outside terminal byte delivery until commit, and ordinary committed Unicode is forwarded unchanged.

**Against rejection:** the stated guarantee is universal and terminal-physical; unit tests cannot establish candidate-window position. A direct accepted-terminal matrix or a narrower support claim is required before Sound can be `done`.

### 4.2 Prover §4.2 — height resize

**Counter verdict: valid as stated and elevated from “unverified” to reproduced for bottom-anchored xterm semantics. Decision-gated.**

C3, plugin geometry (`managed-height-rebase.ts:3-8`), and Pi 0.83's native branch (installed `tui.js:980-989,1065-1077`) establish the mismatch. C4 limits its scope. See A-S2.

### 4.3 Prover §4.3 — notification persistence versus idle equivalence

**Counter verdict: valid as stated under the literal principles. Decision-gated as a diagnostic-visibility policy.**

- Failure paths call `ctx.ui.notify(..., "warning")` through `runtime-coordinator.ts:205-215` and `runtime-failure.ts:7-10`.
- Installed Pi routes warning notifications to `showWarning` (`interactive-mode.js:1907-1918`). `showWarning` appends a `Spacer` and `Text` to `chatContainer` and has no timed removal (`interactive-mode.js:3171-3179`). The content therefore remains in subsequent native renders.
- Existing tests prove emission but model notifications as an array, not TUI components (`managed-runtime.test.ts:190-197`; `test-tui-context.ts:186-219`). They do not test idle visual equivalence.

**Against acceptance:** this is not leftover renderer ownership. The warning is a normal Pi component rendered by the native owner, and it appears only on plugin failure paths with a UI and a successful notify call. If “native result” means native rendering mechanics rather than byte/content identity, the implementation satisfies that narrower reading.

**Against rejection:** the written principles demand visible behavior and static output equal to the original system (`docs/design/principles.md:22-23,38`), not merely native ownership. A plugin-only persistent warning changes that content. Judge needs a user decision to permit diagnostics as an explicit exception or require nonpersistent reporting.

### 4.4 Prover §4.4 — “no second redraw” wording

**Counter verdict: valid as stated. Not decision-gated; normalize the contract.**

- Dirty recapture failure calls saved native `doRender()` (`runtime-patch.ts:109-114`). The regression expects `nativeRenders === 2` but `nativeFullRedraws === 1` (`resize-epoch.test.ts:63-80`). Thus broad “no second redraw” is false.
- Broad wording exists in `docs/audit/viewport-2-active-renderer/decisions.md:17` and `docs/design/known-state.md:23-25`.
- Architecture is narrower: no second **full** redraw (`docs/design/architecture.md:114`). That is true in the tested default case where geometry is unchanged and Pi performs an incremental catch-up.
- Even “never a second full redraw” needs conditions. Installed Pi's catch-up can call `fullRender(true)` if height changed during the gate (`tui.js:1065-1077`) or if `PI_CLEAR_ON_SHRINK=1` and content shrank (`tui.js:127,1079-1085`). The unconditional architectural sentence is therefore broader than the installed consumer contract.

**Against acceptance:** if the gate stayed clean, return performs no second native render. If dirty under unchanged geometry and default `clearOnShrink=false`, C1 confirms one incremental catch-up and only one full width reflow.

**Against rejection:** the implementation intentionally must catch up dirty native content. “No second redraw” cannot describe that path. Correct wording is: one mandatory width full reflow; on dirty return, one native catch-up, normally incremental, with Pi-native full-render branches still authoritative.

### 4.5 Prover §4.5 — terminal allowlist scope

**Counter verdict: valid but wrong scope if treated as a demonstrated compatibility defect; it is an evidence/policy gap. Decision-gated.**

- `detectSupportedTerminal()` accepts `TMUX`, Apple Terminal, iTerm2, WezTerm, kitty, and `TERM` prefixes for xterm, screen, tmux, rxvt, vt100, and ansi; it rejects Zellij and dumb terminals (`detect-supported-terminal.ts:3-8`).
- Direct evidence in the verification record is tmux/xterm-oriented. Apple direct, iTerm2, Kitty, WezTerm, and Zellij matrices remain incomplete (`docs/design/detail/verification-plan.md:35-75`; `docs/design/known-state.md:35-77`).
- The detection function establishes environment-name membership, not support for DSR timing, synchronized updates, scroll regions, resize row mapping, or IME behavior.

**Against acceptance:** lack of a completed matrix is not evidence that CUP, EL2, DSR, or scroll regions fail on every listed emulator. Many are xterm-compatible, and unknown synchronized-update modes may be safely ignored. The finding must remain “unverified compatibility,” not “known broken allowlist.”

**Against rejection:** the accepted set is broader than the evidence, while the principles state unqualified behavior. Sound cannot infer terminal capabilities from names alone. Judge must choose between completing the matrix, narrowing the allowlist/guarantee, or explicitly accepting per-terminal risk.

## 5. Optimization §6 — obligation-by-obligation counter

The Prover's §6 cleanup conclusion is mostly supported, but not as one batch:

1. **Remove `sameViewportArea()` — valid as stated, no gate.** No caller exists (`inline-viewport-area.ts:22-31`).
2. **Remove `renderItemComponents()` — valid as stated, no gate.** No caller exists (`component-ledger-reconciler.ts:109-113`).
3. **Remove `NativeEntryBaseline.expansion` — valid as stated, no gate.** It is always constructed as a no-op and unread (`native-entry-baseline.ts:91`).
4. **Remove `NativeEntryBaseline.originalOriginRow` — valid as stated, no gate.** Assigned and unread (`native-entry-baseline.ts:96`).
5. **Remove `expandedViewport()` and its self-test — valid as production cleanup, no gate.** Only `inline-entry.test.ts:44-45` calls it.
6. **Remove `"poisoned-recovery"` — valid as stated, no gate.** Only the union declaration exists (`runtime-phase.ts:8`).
7. **Remove plugin `TuiInternals.clearOnShrink` typing — valid as scoped cleanup, no gate.** The plugin does not use it; upstream Pi does.
8. **Remove `logDirectory` as “dead” — false.** It is read as a structural precondition (`tui-internals.ts:47`) and by installed Pi (`tui.js:1050-1057`). Removing the plugin check broadens the accepted private ABI. That may be desirable, but strict dominance has not been proved; the ABI-sentinel policy is decision-gated if changed independently of a broader preflight redesign.
9. **Remove `TranscriptLedger.markRendered()` and its self-test — valid as production cleanup, no gate.** Only `transcript-ledger.test.ts:76` calls it; the production committed-mutation guard is elsewhere in renderer snapshot checking.
10. **A-O1-only baseline `displacedEntryRows` — valid as scoped cleanup, no gate.** The baseline field is unread and always zero. Do not remove the distinct renderer-state field consumed by native handoff (`managed-renderer.ts:208`; `native-handoff.ts:21-23`).

Counterexample to wholesale acceptance: deleting the `logDirectory` check changes preflight behavior, and deleting the wrong `displacedEntryRows` would weaken handoff safety. Counterexample to wholesale rejection: the remaining symbols have mechanically empty production consumer sets.

## 6. Diagnosis and recommendation

### Diagnosis

The Challenger's three Sound findings survive, but their boundaries differ:

- A-S1 is a real, bounded raw-input protocol collision, not general input loss.
- A-S2 is now reproduced for bottom-anchored xterm resize and remains terminal-state dependent.
- A-S3 is a concrete lifecycle omission with a direct synthetic reproduction; resumable stop paths can mask it, while quit ordering does not.

The Prover correctly refused to declare Sound or Optimization complete. Its strongest corrections are notification persistence, broad redraw wording, and allowlist evidence. Its cleanup list overreaches only on `logDirectory` and risks name-confusing the live renderer `displacedEntryRows` with the dead baseline field.

### Drift / contradiction check

- The height design (`architecture.md:102`) conflicts with Pi 0.83's explicit non-Termux physical-alignment branch and with C3.
- The width-gate stop rationale “screen already native” quietly changed from “native and current” to merely “last writer was native”; dirty gated content invalidates the stronger premise.
- “No second redraw” drifted between broad wording and “no second full redraw”; installed Pi makes even the latter conditional.
- “Native idle result” drifted between ownership equivalence and visible-content equivalence when persistent diagnostics were introduced.
- “Standard ANSI allowlist” drifted from a syntactic environment allowlist into an implied behavioral guarantee without a completed terminal matrix.

### Recommendation

1. Judge should sustain A-S3 as a non-decision implementation defect and sustain the broad-redraw wording correction.
2. Judge should sustain A-S2 and gate the replacement height policy because it revises a documented design tradeoff.
3. Judge should sustain A-S1's factual collision and gate the late-CPR/input policy; do not label all input generally unsafe.
4. Judge should treat IME and allowlist items as unresolved verification/policy obligations, not reproduced terminal defects.
5. Judge should gate whether persistent plugin diagnostics are an allowed exception to idle visible equivalence.
6. Judge may approve the mechanically dead cleanup items individually, excluding `logDirectory`; preserve the live renderer-state `displacedEntryRows`.

No executor handoff is warranted from Counter. This is a read-only tribunal result; implementation must wait for Judge disposition and the identified user gates.

## 7. Normalized candidate table for Judge

| ID | Counter verdict | Surviving fact | Root layer | Decision-gate status |
|---|---|---|---|---|
| A-S1 | Valid as stated | DSR prefix filtering delays bare Escape through `timeout + 1000 ms`, can consume CPR-shaped input, and cannot hide CPR from earlier Pi listeners. | D / I / terminal policy | **Yes** — late-CPR versus input policy |
| P-4.1 | Valid but wrong scope/severity | Apple/complex IME guarantee is unverified; no direct candidate/composition test establishes failure or safety. | Test / terminal policy | **Yes** — verify or narrow support |
| A-S2 | Valid as stated, MAJOR | Bottom-anchored xterm shrink relocates old rows; plugin preserves absolute-row ownership without re-attestation, unlike Pi 0.83 native non-Termux handling. | D / I / Test | **Yes** — revise height policy |
| P-4.2 | Valid as stated | Height soundness is not merely unverified for xterm bottom anchoring; C3 reproduces the premise failure. | D / I / Test | **Yes** |
| A-S3 | Valid as stated, MAJOR | Dirty gated content is dropped by direct `TUI.stop()` because `dispose(false)` bypasses native catch-up. | I / lifecycle | **No** |
| P-4.3 | Valid as stated under literal principles | Pi warning notifications persist as chat components, changing later native-visible content. | Q / D / I | **Yes** — diagnostic exception policy |
| P-4.4 | Valid as stated | Dirty return performs a second native render; only the normal unchanged-geometry/default branch avoids a second full reflow. | Docs / I / upstream ABI | **No** |
| P-4.5 | Valid but wrong scope/severity | Allowlist breadth exceeds direct evidence; this is not proof every extra terminal is broken. | Test / terminal policy | **Yes** — matrix, narrowing, or accepted risk |
| A-O1 | Valid but wrong scope | Aggregate mixes dead plugin surface with live/scoped fields. | I / ABI | Mixed; see rows below |
| O6-same-area | Valid as stated | `sameViewportArea()` has no consumer. | I | **No** |
| O6-render-items | Valid as stated | `renderItemComponents()` has no consumer. | I | **No** |
| O6-entry-expansion | Valid as stated | Baseline `expansion` is no-op and unread. | I | **No** |
| O6-entry-origin | Valid as stated | Baseline `originalOriginRow` is unread. | I | **No** |
| A-O1-entry-displaced | Valid as stated with narrow scope | Baseline `displacedEntryRows` is unread/always zero; renderer-state field of same name is live. | I | **No** |
| O6-expanded-viewport | Valid as stated with test-only scope | `expandedViewport()` has only a self-test consumer. | I / Test | **No** |
| O6-poisoned-phase | Valid as stated | `"poisoned-recovery"` has no producer or branch. | I | **No** |
| O6-clear-on-shrink | Valid as scoped | Plugin type field is unused; upstream Pi field is live. | I / upstream ABI | **No** |
| O6-log-directory | **False** as dead/unused | Plugin validates it and Pi 0.83 reads it; only necessity as an ABI sentinel is disputed. | I / upstream ABI | **Yes** if changing ABI policy |
| O6-mark-rendered | Valid as stated with test-only scope | `markRendered()` has no production consumer. | I / Test | **No** |
| live-displaced-control | **False** if conflated with A-O1 | `ManagedRendererState.displacedEntryRows` is consumed by native-handoff safety logic. | I | **No removal** |
