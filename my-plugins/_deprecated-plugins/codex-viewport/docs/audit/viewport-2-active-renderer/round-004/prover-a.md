# Round 004-A Prover — Sound / Optimization

## Scope

**Audit object**

- Current code, tests, README, and design/audit documents under `my-plugins/codex-viewport/`.
- Direct Pi runtime consumers:
  - Installed global `@earendil-works/pi-coding-agent` 0.83.0.
  - Installed global `@earendil-works/pi-tui` 0.83.0.
  - Workspace `packages/tui` is 0.80.10 and is used only as secondary source reference, not runtime proof.

**Upstream specification**

- `docs/design/principles.md`
- `docs/design/architecture.md`
- `docs/design/detailed-design.md`
- `docs/design/detail/`
- `docs/design/proofs/`
- `docs/design/known-state.md`
- `docs/audit/viewport-2-active-renderer/workflow-compliance.md`

**Independent verification performed**

```text
node --test --import tsx my-plugins/codex-viewport/*.test.ts
→ 59 tests / 12 suites / 59 pass / 0 fail

npx tsc -p my-plugins/codex-viewport/tsconfig.json
→ pass

git diff --check -- my-plugins/codex-viewport
→ pass

git status --short -- packages
→ zero official-package changes
```

Global Pi smoke artifacts were also inspected:

```text
normal: DSR=1, 2J=0, 3J=0, sync=260, warnings=0
width:  DSR=2, 2J=1, 3J=1, sync=268, warnings=0
```

---

## 1. Intent-to-implementation proof

### 1.1 Stable streaming without repainting committed history

**Intent**

- Dynamic output must not repeatedly repaint prior history: `principles.md:9,33`.
- History must remain single-copy and free of stale intermediate states: `principles.md:14,34`.

**Design**

- Managed area is variable `[top,bottom)`: `architecture.md:51-61`.
- Ordinary diffs use absolute row replacement, while history insertion is isolated to the top stable scroll region: `architecture.md:71-83`.

**Implementation**

- `diffInlineViewport()` skips equal absolute rows and uses CUP + `EL2` only for changed rows: `screen-frame-diff.ts:7-16`.
- Ordinary frame diff contains no CRLF; CRLF exists only in `buildHistoryInsertion()`: `history-insertion.ts:1-6`.
- Expansion/history/frame/cursor are wrapped in one synchronized write: `terminal-render-plan.ts:7-9`.
- Committed components are excluded from `liveItems()` and checked against mutation: `transcript-ledger.ts:146-148`, `managed-renderer.ts:177-181`.

**Tests/evidence**

- Stable elapsed widget replacement contains neither prior bytes nor CRLF: `managed-runtime.test.ts:51-62`.
- Stable rows above the first unfinished component are not cleared: `demand-driven-runtime.test.ts:40-48`.
- Finalized visible rows are not repainted: `demand-driven-runtime.test.ts:65-75`.
- Global normal smoke emitted no `2J/3J` and advanced top history during the run.

**Result:** proven for the tested Pi 0.83 + tmux path, conditional on terminal scroll-region semantics.

---

### 1.2 Earliest unfinished suffix and source-order finality

**Intent**

- The active region begins at the first unfinished transcript item: `principles.md:11`.
- Static/finalized content cannot cross an earlier pending item: `principles.md:12,46`.
- Parallel completion cannot change semantic order: `principles.md:13,36,47`.

**Design**

- Ledger lifecycle is `pending → finalized → prepared → committed`: `architecture.md:63-69`.
- Only the maximal continuous finalized prefix can commit: `architecture.md:69`.

**Implementation**

- `prepareCommit()` skips the committed prefix, then stops at the first pending or component-less item: `transcript-ledger.ts:104-126`.
- Baseline committed items must form a prefix: `transcript-ledger.ts:35-50`.
- Committed component disappearance or reordering is rejected: `transcript-ledger.ts:77-101`.
- Tool and assistant finality comes from lifecycle events: `component-ledger-reconciler.ts:35-59`.
- Static constructors are born finalized; unknown tail content remains opaque/pending until displaced: `component-ledger-reconciler.ts:5-11,78-91`.
- Width re-entry starts at the first non-committed component: `component-ledger-reconciler.ts:95-97`, `width-reentry.ts:28-36`.

**Tests**

- Maximal finalized prefix: `transcript-ledger.test.ts:19-32`.
- Finalized static content remains behind pending assistant: `transcript-ledger.test.ts:34-43`.
- Generated completion permutations preserve the frontier: `transcript-ledger.test.ts:88-120`.
- Finalized custom suffix below pending content is not repainted: `demand-driven-runtime.test.ts:95-107`.

**Result:** proven for assistant/tool/static/opaque classifications supported by Pi 0.83.

---

### 1.3 Demand-driven variable geometry

**Intent**

- Stable visible content must not disappear without real new output pressure.
- Editor/footer must not be pushed outside the terminal: `principles.md:27`.
- The plugin must control only the necessary dynamic boundary: `principles.md:16`.

**Design**

- Initial bottom is the end of native content, not terminal bottom: `architecture.md:39-49`.
- Growth consumes unused rows below before moving top upward: `architecture.md:51-59`.

**Implementation**

- Entry computes:
  - physical origin from DSR and Pi cursor baseline: `native-entry-baseline.ts:35-43`;
  - stable boundary from the first native mismatch: `native-entry-baseline.ts:44-56`;
  - native content bottom independently of terminal bottom: `native-entry-baseline.ts:57-61`;
  - an initial frame seeded from native physical rows: `native-entry-baseline.ts:62-79`.
- Area invariant is `0 ≤ top < bottom ≤ terminalHeight`: `inline-viewport-area.ts:9-19`.
- Growth is downward-first and upward only for remaining overflow: `live-region-growth.ts:9-19`.
- Editor/footer are mandatory and are allocated before widgets/live transcript: `volatile-region.ts:14-21,28-50`.
- Managed renderer calculates intrinsic demand before growth: `managed-renderer.ts:95-103`.

**Tests**

- No clear above stable prefix: `demand-driven-runtime.test.ts:40-48`.
- One extra live row causes one-row upward expansion: `demand-driven-runtime.test.ts:51-62`.
- Oversized widgets preserve Editor/footer: `managed-runtime.test.ts:65-80`.

**Result:** pure geometry and fake-TUI behavior proven. Real vertical terminal resize remains an unproven obligation; see §4.2.

---

### 1.4 Physical history insertion and single-copy transaction

**Intent**

- Finalized history must advance during the run instead of waiting for `agent_end`: `principles.md:45,50,59`.
- No duplicate physical history: `principles.md:14,34`.

**Implementation**

- Prepared rows are retained only within current visible capacity; older finalized rows become spill: `managed-renderer.ts:111-128`, `protected-history-rows.ts:22-33`.
- History insertion is restricted to rows `1..area.top`: `history-insertion.ts:1-6`.
- Memory states advance only after terminal write succeeds: `managed-renderer.ts:131-145`.
- On write failure, prepared state is canceled and the runtime recovers natively: `managed-renderer.ts:132-149`, `runtime-patch.ts:188-192`.
- Handoff primes Pi only after visible bytes, cursor, geometry, and provenance match: `native-handoff.ts:15-49`.

**Tests**

- Xterm top-region insertion increases scrollback while preserving lower viewport: `terminal-plan.test.ts:22-30`.
- Finalized rows enter history while a later tool is still pending: `demand-driven-runtime.test.ts:78-92`.
- Protected spill ordering: `managed-runtime.test.ts:83-107`.
- Handoff equality and displacement rejection: `native-handoff.test.ts:20-55`.

**Result:** proven for standard top-anchored scroll-region behavior and successful terminal writes. Partial writes cannot be rolled back and are correctly declared as risk.

---

### 1.5 Renderer ownership and native handoff

**Intent**

- Exactly one renderer owner at a time: `principles.md:28,35,48`.
- Idle/static behavior returns to native Pi: `principles.md:22-23,37-38`.

**Implementation**

- The patch installs instance-owned `doRender` and `stop`, shadowing Pi prototype methods: `runtime-patch.ts:31-55`.
- Entry gate performs no frame render until renderer activation: `runtime-patch.ts:150-158`.
- Reentrant requests are coalesced: `runtime-patch.ts:131-147`.
- Recovery restores methods before calling saved native render: `runtime-patch.ts:83-106`.
- Handoff deletes only the plugin-owned instance methods: `runtime-patch.ts:195-199`.
- Foreign own-method owners are rejected: `runtime-patch-preflight.ts:15-20`.

**Pi 0.83 consumer verification**

- Native scheduler calls `this.doRender()` dynamically, so the instance override is observed.
- Global Pi 0.83 width changes use native `fullRender(true)` and emit `2J/H/3J`: installed `pi-tui/dist/tui.js:980-1012,1065-1069`.
- Global `hasOverlay()` filters hidden overlays: installed `pi-tui/dist/tui.js:403-414`.

**Tests**

- Gate writes no managed frame before activation: `runtime-patch.test.ts`.
- Existing renderer owner and incompatible layout are rejected.
- Reentrant render is coalesced: `managed-runtime.test.ts:122-129`.
- Stop and shutdown restore native ownership: `managed-runtime.test.ts:132-149`.

**Result:** renderer exclusivity is proven for Pi 0.83’s current private ABI.

---

### 1.6 Width transition

**Intent**

- Width may flash once for native reflow, then managed ownership resumes.
- Ownership transitions must use a physically valid baseline: `principles.md:28,35`.

**Implementation**

- Width mismatch returns a distinct outcome before managed paint: `managed-renderer.ts:74-80`.
- Saved native `doRender` performs the reflow; the renderer is then gated: `runtime-patch.ts:159-176`.
- Re-entry performs a second DSR and retains the same ledger: `width-reentry.ts:17-40`.
- Async generation/abort/patch identity prevents stale re-entry: `runtime-coordinator.ts:162-176,192-202`.
- Dirty gated content receives native catch-up on recapture failure: `runtime-patch.ts:109-114`.
- Partial native redraw failure is sanitized and is not synchronously retried: `runtime-patch.ts:161-172`.

**Tests**

- One full native redraw followed by managed rendering: `resize-epoch.test.ts:43-61`.
- Dirty content catch-up after recapture timeout: `resize-epoch.test.ts:63-80`.
- Catch-up throw cleanup: `resize-epoch.test.ts:82-100`.
- Partial width redraw is not synchronously retried: `resize-epoch.test.ts:102-112`.
- Agent-end cancellation leaves native ownership: `resize-epoch.test.ts:114-125`.

**Global evidence**

```text
DSR=2
2J/3J=1/1
managed frames continue after second DSR
warnings=0
```

**Result:** normal width re-entry and injected failure paths are proven.

---

### 1.7 Height/footer/widget transitions

**Implementation**

- Height changes are handled by `rebaseManagedHeight()`: `managed-height-rebase.ts:3-8`.
- Stable provenance is deliberately marked unknown after a terminal-height change: `managed-renderer.ts:86-94`.
- Renderer stays active and does not call native render in the fake-TUI regression: `resize-epoch.test.ts:22-40`.

**Result:** implementation matches the design mechanically, but its terminal-level soundness is not proven; see §4.2.

---

### 1.8 Stop, shutdown, reload, and hard death

**Intent**

- Every running→static path must return to native state: `principles.md:23-25,37-38`.
- Plugin state must not survive hard restart: `principles.md:24`.

**Implementation**

- Managed `stop()` performs synchronous recovery before native stop: `runtime-patch.ts:122-129`.
- Width-recapture stop uses the already-native frame: `runtime-patch.ts:124-127`.
- Entry and width recapture are canceled by generation and `AbortController`: `runtime-coordinator.ts:117-149,196-202`.
- Session replacement and shutdown restore or dispose the patch: `runtime-coordinator.ts:21-44,136-149`.
- No extension-owned global mutable state exists; `RuntimeCoordinator` is session-local inside the extension factory: `codex-viewport.ts:19-23`.

**Pi 0.83 consumer verification**

- Extension handlers run before UI listeners and before message persistence: installed `agent-session.js:350-365,428-508`.
- Interactive quit stops TUI before runtime disposal; signal shutdown disposes extensions before stop: installed `interactive-mode.js:2886-2906`.
- Pi persists messages only after `message_end`: installed `agent-session.js:355-365`.

**Tests**

- Delayed entry cannot resurrect after agent end or shutdown: `runtime-coordinator.test.ts`.
- Stop/shutdown exception paths restore method ownership: `managed-runtime.test.ts:132-149`.

**Result:** graceful lifecycle paths are proven. SIGKILL leaves terminal bytes unrecoverable, but plugin state is not persisted and the limitation is declared.

---

### 1.9 AI, session, tool, abort, and input isolation

**Intent**

- No mutation of provider messages, tools, results, abort state, or session persistence: `principles.md:20-21,39`.
- Reuse Pi Editor/input rather than replacing them: `principles.md:16,29,40`.

**Implementation**

- Plugin registers only lifecycle observers; it has no provider, prompt, `tool_result`, or persistence hooks: `codex-viewport.ts:19-58`.
- Event handlers return no replacement message or tool result.
- Input interception is limited to the DSR query; adjacent bytes are returned to Pi’s input chain: `query-terminal-cursor.ts:43-64`.
- Pi Editor, widgets, footer, and components are rendered directly from Pi’s existing tree: `managed-render-content.ts:11-24`.

**Pi 0.83 consumer verification**

- Extension events are awaited before UI listeners and persistence.
- `message_end` replacement requires an explicit returned message; this extension returns none.
- Input listeners transform data before the focused Editor receives it: global and workspace TUI input chain semantics match.

**Tests**

- Event payload remains byte-identical and abort is never called: `runtime-event-isolation.test.ts:10-43`.
- Adjacent and split DSR input handling: `query-terminal-cursor.test.ts:11-49`.
- Cancel replays incomplete escape prefix: `query-terminal-cursor.test.ts:51-72`.

**Result:** AI/session/tool isolation is proven. General IME safety is not; see §4.1.

---

## 2. Hidden-premise register

| Premise | Status | Evidence / consequence |
|---|---|---|
| Pi extension handlers complete before corresponding UI component mutation | **Verified** | Global 0.83 `agent-session.js:350-365,428-508`; prevents ledger lifecycle lag |
| Pi width change performs one full clear/reflow and updates native baseline | **Verified** | Global 0.83 `pi-tui/dist/tui.js:980-1048,1065-1069` |
| Pi scheduler resolves `this.doRender` dynamically | **Verified** | Global 0.83 TUI scheduler; required for instance shadow patch |
| Hidden overlays remain in stack but `hasOverlay()` ignores them | **Verified** | Global 0.83 `pi-tui/dist/tui.js:403-414` |
| Static constructor names match Pi 0.83 | **Verified** | Installed global dist contains all five allowlisted class names |
| Pi component tree remains the canonical complete transcript after managed physical insertion | **Verified for Pi 0.83** | Plugin never detaches components; native width smoke reconstructs full output |
| Standard top scroll-region insertion produces scrollback without moving lower viewport | **Verified in xterm/tmux** | `terminal-plan.test.ts:22-30`; global normal smoke |
| The same scroll-region behavior holds for every accepted terminal | **Unverified** | iTerm2/Kitty/WezTerm/Apple direct matrix absent |
| Vertical terminal resize preserves enough absolute row mapping for diff without DSR/native reflow | **Unverified** | Fake TUI changes only `rows`; global Pi itself chooses full redraw on height change |
| DSR reply arrives within 150 ms in supported environments | **Assumed with fallback** | Timeout safely returns native, but may disable feature |
| User/other-extension input cannot be indistinguishable from `CSI row;col R` during DSR window | **Assumed** | Terminal protocol is inherently untagged; CPR-shaped input would be consumed |
| Component render is deterministic between unchanged states | **Assumed and guarded after commit** | Committed mutation triggers recovery, but pre-commit nondeterminism can alter frames |
| Third-party extensions do not write directly to stdout during managed mode | **Explicit unsupported premise** | `known-state.md:75` |
| Terminal write is atomic | **Explicitly false** | Partial write cannot roll back; recovery is best effort |
| Apple Terminal IME composition remains safe under repeated CUP/cursor writes | **Unverified** | No direct composition/candidate test |
| Plugin failure notifications are harmless to idle visual equivalence | **False** | See §4.3 |

---

## 3. Optimization proof

### 3.1 Complexity that is justified

| Structure | Why simpler alternatives fail |
|---|---|
| Instance `doRender` ownership | Component-only virtualization cannot commit physical scrollback or guarantee single writer |
| DSR entry | Pi private logical baseline does not expose the terminal’s physical inline origin |
| Transcript ledger | Parallel completion requires a source-order finalized frontier |
| Protected vs stable rows | A finalized row may be immutable yet still visible; conflating visibility with commitment caused the rejected full-screen design |
| Variable top and bottom | Fixed full-height area caused premature clearing; fixed short area cannot absorb growing output |
| Top-only scroll region | Ordinary CRLF would scroll Editor/widgets and leak volatile frames into history |
| Native width reflow | Existing wrapped history cannot be safely rewrapped by row diff alone |
| Re-entry generation/abort identity | Async DSR can otherwise reactivate stale ownership after finish/shutdown |
| Native handoff equality | Priming Pi without byte/cursor equality recreates duplicate history and cursor drift |
| Explicit image/overlay fallback | Managed text-row proofs do not cover image reservation or overlay composition |

The following simpler candidates are unsound:

1. **Native renderer only:** retains native history repaint/flicker behavior.
2. **Single fixed component LiveRegion:** cannot perform physical history insertion and pins static suffixes.
3. **Defer everything until `agent_end`:** violates Editor stability and in-run history progress.
4. **Full alternate-screen takeover:** violates native scrollback and “do not reimplement TUI.”
5. **Fixed `[top,terminalBottom)` area:** reproduces the observed sudden clear.
6. **Rebuild ledger after width redraw:** loses logical identity/finality and risks duplicate physical history.
7. **Always native after resize:** contradicts the user’s accepted one-flash-then-resume behavior.

### 3.2 Unsupported or removable complexity

Strict O does **not** currently pass. The following production structures have no consumer or no governing decision:

- `sameViewportArea()` is exported but unused: `inline-viewport-area.ts:22-31`.
- `renderItemComponents()` is exported but unused: `component-ledger-reconciler.ts:109-113`.
- `NativeEntryBaseline.expansion` is always zero and never consumed: `native-entry-baseline.ts:10-18,88-97`.
- `NativeEntryBaseline.originalOriginRow` is stored but never consumed: `native-entry-baseline.ts:18,96`.
- `expandedViewport()` exists only for a pure test; production growth constructs the area directly: `viewport-expansion.ts:21-26`.
- `RuntimePhase` contains unreachable `"poisoned-recovery"`.
- `TuiInternals.clearOnShrink` and `logDirectory` are required by the structural ABI despite no production use, unnecessarily narrowing compatibility: `tui-internals.ts:29-31,47`.
- `TranscriptLedger.markRendered()` is only called by its own test; committed mutation is actually enforced through `ManagedRenderer` snapshots: `transcript-ledger.ts:70-75`, `managed-renderer.ts:177-181`.

These are direct implementation-layer cleanup items, not user decisions.

---

## 4. Failed proof obligations

### 4.1 IME safety cannot be proven

**Claim**

`principles.md:26` requires Chinese and complex IME composition/candidate/commit behavior not to become misplaced, duplicated, or crash because of plugin ownership.

**Evidence gap**

- `known-state.md:73` explicitly says direct Apple Terminal composition/candidate verification is absent.
- No test contains a real IME composition or candidate-window protocol.
- Tmux committed Chinese text is not equivalent to native macOS IME composition.
- Every managed render still emits final CUP/cursor visibility bytes: `managed-renderer.ts:130-133`, `cursor-placement.ts:4-7`.

**Root layer:** Q/D verification boundary. Either the absolute principle requires direct Apple Terminal validation, or the principle must be reframed as a target rather than a proven guarantee through user decision.

**Status:** failed/unverified Sound obligation.

---

### 4.2 Height rebase lacks terminal-level soundness proof

**Claim**

Architecture says terminal-height changes remain managed without native renderer: `architecture.md:100-103`.

**Implementation**

`rebaseManagedHeight()` changes logical geometry using only the new row count: `managed-height-rebase.ts:3-8`. It does not query DSR or recapture physical rows.

**Contrary consumer evidence**

Pi 0.83 itself considers non-Termux height changes unsafe for ordinary differential rendering and performs `fullRender(true)` “to keep the visible viewport aligned”: global `pi-tui/dist/tui.js:1071-1077`.

The fake test changes only a numeric `rows` property and does not model a terminal emulator’s viewport/cursor movement: `resize-epoch.test.ts:22-40`.

**Hidden premise:** terminal height resize preserves the plugin’s old absolute row mapping. This is unverified across every accepted terminal.

**Root layer:** D/I. The design introduced a stronger height behavior than the consumer evidence supports.

**Status:** failed/unverified Sound obligation.

---

### 4.3 Failure notifications violate idle visual equivalence

**Claim**

- Idle visible behavior must be exactly native Pi: `principles.md:22-23,37-38`.
- Plugin failure should return display to native Pi: `principles.md:25`.

**Implementation**

- Entry failure and native recovery call `ctx.ui.notify`: `runtime-coordinator.ts:205-215`.
- Pi 0.83 implements info notification by appending persistent `Spacer` and `Text` components to the chat: global `interactive-mode.js:2578-2600`.

After the run returns to native ownership, that plugin-specific warning remains visible. Renderer ownership is native, but visible output is not equivalent to Pi without the plugin.

**Root layer:** I, with a documentation overclaim at `README.md:38`.

**Status:** failed Sound obligation.

---

### 4.4 Width-recapture documentation contradicts implementation

**Claims**

- `README.md:42`: recapture failure remains native “without a second redraw.”
- `known-state.md:25`, `decisions.md:17`, and `hoare-handoff.md:9` make the same broad claim.

**Implementation/test**

- Dirty gate recapture failure calls saved native `doRender` for catch-up: `runtime-patch.ts:109-114`.
- Regression explicitly expects `nativeRenders === 2` and `nativeFullRedraws === 1`: `resize-epoch.test.ts:63-79`.

The correct claim is “no second **full clear/reflow** when geometry is unchanged; a native incremental catch-up may occur.”

**Root layer:** D/documentation.

**Status:** failed internal-consistency Sound obligation.

---

### 4.5 Terminal allowlist exceeds verified terminal semantics

**Implementation**

`detectSupportedTerminal()` accepts Apple Terminal, iTerm2, WezTerm, kitty, tmux, xterm, screen, rxvt, vt100, and ansi patterns: `detect-supported-terminal.ts:3-8`.

**Evidence**

`known-state.md:73-74` says Apple direct, iTerm2, Kitty, WezTerm, and Zellij matrices are incomplete. Only tmux/xterm behavior has direct evidence.

This does not prove those terminals are broken, but it means the allowlist is a capability assumption, not an evidence-backed compatibility guarantee.

**Root layer:** D/I verification boundary.

**Status:** conditional Sound only; must remain an explicit unverified premise.

---

## 5. Sound status

### Proven

- Source-order finalized frontier.
- Parallel completion ordering.
- Demand-driven variable geometry as a pure algorithm.
- Native-seeded initial frame.
- Top-only history transaction.
- Successful single-copy managed commit.
- Width native reflow and re-entry on the tested Pi 0.83 runtime.
- Stop/shutdown ownership restoration.
- AI/provider/tool/session mutation isolation.
- Hard-death non-persistence boundary.
- Image and visible-overlay fallback.
- Persistent hidden-overlay handling.
- Official `packages/` zero modification.

### Not proven / contradicted

1. Direct Apple Terminal IME safety.
2. Height-resize physical-row soundness.
3. Idle visual equivalence after plugin-generated failure notifications.
4. “No second redraw” documentation on dirty recapture failure.
5. Cross-terminal behavior for the full allowlist.

**S — partial, not done.**

The implementation is sound only under a narrower contract:

```text
Pi/TUI 0.83 private ABI
+ tested tmux/xterm terminal semantics
+ no direct stdout writer
+ no vertical terminal resize requiring physical re-anchoring
+ no claim of real Apple IME safety
+ plugin diagnostic rows accepted as a visible deviation
```

That narrower contract does not fully satisfy the current principles.

---

## 6. Optimization status

The core architecture is materially simpler than full TUI takeover and each major state mechanism has a demonstrated necessity. However strict Optimization fails while unused fields, functions, exports, ABI requirements, and an unreachable phase remain.

**O — partial, not done.**

Direct non-decisional cleanup candidates:

1. Remove unused `sameViewportArea`.
2. Remove unused `renderItemComponents`.
3. Remove dead `NativeEntryBaseline.expansion` and `originalOriginRow`.
4. Remove test-only `expandedViewport` from production.
5. Remove unreachable `poisoned-recovery`.
6. Remove unused `clearOnShrink`/`logDirectory` ABI requirements.
7. Remove or integrate `markRendered`.

---

## 7. Reserved for Round 004-B

Round B must still examine:

- Exhaustive transition completeness across every static/dynamic entry and exit.
- Opaque component classes and all Pi chat consumers.
- Abort/error/retry, session switch, reload, Ctrl+Z, external editor, and hard-death test completeness.
- Documentation duplication and stale fixed-area remnants.
- Dead/obsolete viewport-1 artifacts and module inventory.
- Test claims that exceed what fake TUI or tmux actually establishes.
- Concision across README, architecture, detail, proofs, known-state, and audit mirrors.
- Whether accepted-risk records are sufficiently explicit for terminal/IME/partial-write boundaries.