# HoarePrompt Functional Proof — codex-viewport Active Renderer, Round 005

## 0. Scope, admissible specification, and result

**Targets:** `managed-renderer.ts`, `transcript-ledger.ts`, `component-ledger-reconciler.ts`, `managed-render-content.ts`, `volatile-region.ts`, `live-region-growth.ts`, `managed-height-rebase.ts`, `inline-viewport-area.ts`, `inline-viewport-frame.ts`, `screen-frame-diff.ts`, `terminal-render-plan.ts`, `cursor-placement.ts`, and `stable-screen-rows.ts`.

**Admissible specification:** only `README.md` and `docs/design/**`. Existing `docs/audit/**` was not read or used. No requirement is inferred from a test or from preferred implementation style.

**Input-state note:** `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` did not exist. `/Users/ssyram/workspace/ai-tools/pi-mono/progress.md` contained only `Status: In Progress` with empty Tasks, Files Changed, and Notes sections.

**Evidence limitation:** all target source files and the complete README/design corpus were read. The repository test filenames and the design verification record were identified, but direct full test-body reading could not be completed before the execution environment stopped further browsing at its tool-call limit. Consequently, test-count statements below are documentation claims, not independently re-established evidence. This proof does not promote a function to `PROVEN` merely because a test is documented.

### Verdict summary

| Module | Functions | Verdict |
|---|---:|---|
| `managed-renderer.ts` | 11 | `render` **DISPROVEN**; 5 `PROVEN`; 5 `PARTIAL` |
| `transcript-ledger.ts` | 14 | 11 `PROVEN`; 3 `PARTIAL` |
| `component-ledger-reconciler.ts` | 9 | 5 `PROVEN`; 4 `PARTIAL` |
| `managed-render-content.ts` | 1 | `PROVEN` |
| `volatile-region.ts` | 3 | all `PROVEN` |
| `live-region-growth.ts` | 1 | **DISPROVEN** |
| `managed-height-rebase.ts` | 1 | `PROVEN` |
| `inline-viewport-area.ts` | 1 | `PROVEN` |
| `inline-viewport-frame.ts` | 1 | **DISPROVEN** |
| `screen-frame-diff.ts` | 3 | `diffInlineViewport` **DISPROVEN**; 2 `PROVEN` |
| `terminal-render-plan.ts` | 1 | `PROVEN` |
| `cursor-placement.ts` | 1 | `PROVEN` under a valid-frame PRE |
| `stable-screen-rows.ts` | 4 | 2 `PROVEN`; 2 `PARTIAL` |

There are four concrete specification failures:

1. `planLiveRegionGrowth` never performs the required upward growth after `bottom` reaches terminal bottom.
2. Therefore `ManagedRenderer.render` crops pending content while contractually available rows still exist above `area.top`.
3. `createInlineViewportFrame` accepts a cursor column outside the viewport despite the design requiring the cursor to be in bounds.
4. `diffInlineViewport` does not erase physical rows relinquished when `next.area.bottom < previous.area.bottom`, although the design permits top/bottom changes and defines the region below `bottom` as blank native space.

---

## 1. Extracted PRE, POST, and invariants

No function-level contract below is invented. The following are direct normalizations of the README/design statements.

### 1.1 Geometry invariant `G`

From `docs/design/detail/frame-layout.md` (“Geometry”), `docs/design/detailed-design.md` §4, and `docs/design/architecture.md` §§3–4:

```text
G(area) ≜
  integers(area.top, area.bottom, area.width, area.terminalHeight)
  ∧ area.width > 0
  ∧ area.terminalHeight > 0
  ∧ 0 ≤ area.top < area.bottom ≤ area.terminalHeight
  ∧ area.height = area.bottom - area.top.
```

`[0,top)` is stable visible space, `[top,bottom)` is managed, and `[bottom,terminalHeight)` is unused native blank space.

### 1.2 Growth contract `GR`

From `docs/design/detail/frame-layout.md` (“Growth”), `docs/design/detailed-design.md` §4, `docs/design/proofs/hoare-fixed-partition.md`, and README “Runtime model”:

```text
PRE: G(area) ∧ overflow ∈ ℤ ∧ overflow ≥ 0.
down = min(overflow, terminalHeight-bottom).
remaining = overflow-down.
up = min(remaining, available safe rows above top).
POST:
  next.bottom = bottom+down
  ∧ next.top = top-up
  ∧ next.height = old.height+down+up
  ∧ growth equals real overflow until safe terminal capacity is exhausted
  ∧ downward growth precedes upward growth
  ∧ stable rows are not scrolled by ordinary managed output.
```

The design texts differ on the exact small-top reserve: `hoare-fixed-partition.md` uses `max(0,top-2)`, while `frame-layout.md` says top can grow upward and `top=0/1` is still diffable but unsafe for history insertion. History insertion was subsequently removed. That disagreement does **not** affect the counterexample below because both variants require upward growth from `top=3`.

### 1.3 Frame and volatile invariant `F`

From `docs/design/detail/volatile-region.md`, `docs/design/detail/physical-frame.md`, README “Guarantees,” and `docs/design/fixes/atomic-block-native-commit.md`:

```text
F(frame) ≜ G(frame.area)
  ∧ frame.rows.length = frame.area.height
  ∧ absent(frame.cursor) ∨ cursor is area-relative and in bounds.

Frame order:
  pending transcript tail
  → before-editor/status/widget-above tail
  → complete Editor
  → after-editor/widget-below tail
  → complete Footer
  → bottom-only empty slack.
```

Editor and Footer are mandatory. If their combined height exceeds available grown capacity, native fallback is required. Widgets are cropped from their top; pending transcript is cropped from its top last. Ordinary diffs use absolute CUP plus `CSI 2K`, never CRLF.

### 1.4 Ledger invariant `L`

From `docs/design/detail/transcript-ledger.md` §§2–8 and `docs/design/proofs/hoare-ledger.md`:

```text
L(items, p, prepared) ≜
  ids are unique
  ∧ each component identity belongs to at most one item
  ∧ item order equals semantic chat order
  ∧ committed ⇒ finalized
  ∧ committed items are exactly items[0..p)
  ∧ at most one prepared batch
  ∧ prepared items, if any, are a contiguous prefix from p.
```

Finality comes only from lifecycle evidence or documented static/opaque-tail rules. `prepareCommit` prepares the maximal contiguous finalized, nonempty prefix at the frontier. A later finalized item cannot cross an earlier pending item. Commit is allowed only after successful terminal write; cancel returns prepared items to live without changing finality/frontier.

### 1.5 Managed transaction invariant `R`

From `docs/design/detail/managed-renderer.md`, `docs/design/detailed-design.md` §7, and `docs/design/proofs/hoare-render-transaction.md`:

```text
R ≜ L ∧ G(area)
  ∧ stable rows are attested or explicitly unknown
  ∧ previous frame equals managed terminal cells
  ∧ owner = managed
  ∧ ordinary output does not scroll history.
```

Required order:

```text
preflight
→ reconcile/prepare maximal finalized prefix
→ intrinsic demand and height/growth plan
→ frame diff and cursor
→ exactly one synchronized terminal.write
→ accept ledger/frame/geometry previews.
```

A pre-write failure cancels preparation and does not accept the transaction. A write failure does not accept or resend. Width mismatch exits to native reflow/recapture; height changes remain managed. Only one renderer owns terminal output.

### 1.6 Stable-row invariant `S`

From `docs/design/detail/stable-history-tail.md` and native handoff design:

```text
S ≜ currentRows.length ≤ capacity
  ∧ known ⇒ currentRows.length = capacity
  ∧ rows represent attested visible bytes above managed area.
```

Stable rows are handoff evidence only; they do not own history and do not receive finalized component rows.

---

## 2. Natural strongest-postcondition proof: `managed-renderer.ts`

### 2.1 `constructor` — **PARTIAL**

Source: `managed-renderer.ts:44-59`.

**PRE:** valid native entry baseline supplies `G(entry.area)`, an optional valid initial frame for that area, attested initial stable rows, Pi layout, reconciler satisfying `L`, and a run-scoped owner.

**Line SP:** assignments at lines 51–58 yield `tui=tui₀`, `layout=layout₀`, `reconciler=reconciler₀`, `area=entry.area`, `frame=entry.initialFrame`, a `StableScreenRows` object with capacity `area.top`, frozen initial `toolsExpanded`, and snapshots for every initially committed component.

**POST established:** renderer state is initialized from native provenance and contains no terminal write.

**Untraced lines/obligations:** lines 51–58 rely on `NativeEntryBaseline`, `PiLayout`, `TuiInternals`, `StableScreenRows`, and deterministic `Component.render(width)` contracts not established inside this module. No check proves `initialFrame.area` equals `entry.area`. Thus this is conditional, not closed.

### 2.2 `beginDrain` — **PROVEN**

Source: `managed-renderer.ts:61`.

**PRE:** arbitrary renderer state.

**SP:** assignment yields `draining=true`; every other field is unchanged.

**POST:** next successfully accepted frame may return `handoff-ready`, matching the design’s “agent_end only sets drain; the next patched frame observes final component tree.”

**Untraced lines:** none.

### 2.3 `snapshotDetails` — **PARTIAL**

Source: `managed-renderer.ts:63-71`.

**SP by statement:** line 64 maps the committed snapshot map to new record/line arrays; lines 65–70 return shallow copies of area/frame and copies of stable/frame/snapshot row arrays plus scalar state.

**Established:** callers cannot mutate the renderer’s row arrays through the returned arrays.

**Untraced lines:** all behavior at lines 63–71 is diagnostic and has no README/design PRE or POST. Component names depend on runtime `constructor.name`; nested component identities are intentionally omitted. Correctness as a diagnostic API therefore remains unspecified.

### 2.4 `render` — **DISPROVEN**

Source: `managed-renderer.ts:73-133`.

Let the entry state satisfy `R`; `prepared=⊥` and `snapshotPreview=∅` after lines 74–75.

#### CFG path proof

1. **Width mismatch** (`:77`): SP is unchanged renderer/ledger/terminal state and outcome `width-changed`. This satisfies the width-epoch contract.
2. **Preflight rejection** (`:78-79`): SP is unchanged managed state and `native-fallback(reason)`. The four rejection reasons are proven separately in §2.7.
3. **Reconcile** (`:80`): assuming reconciler PRE, ledger visible bindings/order are updated. No terminal state changes.
4. **Committed snapshot assertion** (`:81`): either all current normalized bytes equal committed snapshots, or control reaches outer catch with `prepared=⊥` and `native-fallback("committed component mutated")`.
5. **Prepare** (`:82`): either no frontier exists and `prepared=⊥`, or the maximal finalized prefix is marked prepared with immutable raw lines and normalized component snapshots staged in `snapshotPreview`. Render exceptions reach outer catch before ledger preparation is installed.
6. **Render intrinsic content** (`:83-84`): `content` has all noncommitted transcript components and trailing UI in specified semantic order; `mandatoryRows=|editor|+|footer|`.
7. **Height rebase** (`:85-89`): if terminal height changed, `G(heightArea)` holds; stable evidence is resized and explicitly made unknown. Otherwise stable evidence is preserved.
8. **Demand** (`:90-95`): `desiredHeight` is the exact sum of pending and trailing section row counts.
9. **Growth** (`:96`): this delegates to the disproven `planLiveRegionGrowth`; it only grows down and cannot satisfy `GR` after bottom saturation.
10. **Stable adjustment branch** (`:97-104`): if top changed, capacity and suffix are rebased. In the current implementation this branch is reachable from height rebase but never from upward overflow growth. The constructor correctly makes `known=false` if insufficient rows remain.
11. **Capacity** (`:105-106`): undefined exactly when mandatory Editor+Footer exceed current growth area; throwing reaches outer fallback and attempts preparation cancel.
12. **Volatile render** (`:107-111`): success yields exactly `area.height` ordered rows; fallback throws. The fallback check is redundant with capacity but coherent.
13. **Normalization/frame/diff/plan** (`:112-115`): assuming official normalization preserves row count and yields an in-bounds cursor, a full frame and synchronized terminal plan result. A bad normalization result throws before terminal write.
14. **Write failure** (`:116-121`): thrown terminal write causes best-effort preparation cancel and returns `write-failure`; geometry, frame, stable-row, displacement, snapshot, and finalized-row counters are not accepted. No resend occurs. Partial physical bytes cannot be rolled back, exactly as the design’s residual risk states.
15. **Write success** (`:122-126`): prepared prefix is committed; snapshots and finalized-row count advance; stable rows, displacement, area, and frame are accepted only after write returns.
16. **Outcome branches** (`:127-128`): `draining` gives `handoff-ready`; otherwise a committed prefix gives `native-commit`; otherwise `rendered`.
17. **Outer failure** (`:129-132`): best-effort cancel and `native-fallback(String(error))`.

#### Concrete counterexample 1: required upward growth is skipped

Take a valid state:

```text
area = { width:80, terminalHeight:10, top:3, bottom:10, height:7 }
mandatoryRows = 2
pendingLive.length + all trailing lengths = 9
desired overflow = 2
```

Both `frame-layout.md` Growth and `hoare-fixed-partition.md` require upward growth from `top=3` (to `top=1` under the unrestricted statement, or at least `top=2` under the two-row reserve proof). Line 96 calls `planLiveRegionGrowth`, which returns the unchanged area because `terminalHeight-bottom=0`. Lines 105–110 consequently allocate only seven rows and crop two pending rows although at least one contractually usable row exists above `top`. Thus `R ∧ PRE(render) ⇏ POST(render)`.

#### Concrete counterexample 2: pre-write failure does not preserve all old memory state

Start with a valid ledger and a newly visible static chat component not yet recorded. `reconcile` at line 80 adds/finalizes it and increments ledger revision. Let Editor+Footer then exceed terminal capacity so line 106 throws. The outer catch cancels a prepared batch if present, but it does not undo reconciliation. The documented render proof says prepare-stage failure leaves old memory state unchanged; the ledger is observably changed. This does not corrupt source order, but it falsifies the stated all-state transactional postcondition.

**Untraced lines:** line 117 assumes `terminal.write` returning means acceptance may proceed, although design research explicitly says terminal writes lack physical atomic-commit confirmation. Lines 80–83 assume component rendering is synchronous, deterministic, and side-effect free. Lines 112–115 rely on normalization and cursor extraction. `render` is already `DISPROVEN`; these assumptions are additional proof gaps, not extra inferred requirements.

### 2.5 `prepareCommit` — **PARTIAL**

Source: `managed-renderer.ts:135-144`.

**SP:** for each item selected by ledger frontier scanning, lines 137–141 render each component at current width, store its normalized snapshot, and concatenate raw lines. If all renders return, the ledger’s `prepareCommit` establishes its prepared-token POST; if a render throws, the ledger remains unprepared.

**Untraced:** component rendering is invoked once here and again in `renderManagedContent`; equality between both invocations depends on deterministic/pure official `Component.render`. Snapshot normalization and raw commit row-count equivalence depend on `normalizeLines`. No design contract permits render-time side effects.

### 2.6 `acceptPrepared` — **PROVEN**

Source: `managed-renderer.ts:146-151`.

**PRE:** token is current and terminal write has successfully returned; snapshots correspond exactly to token components.

**SP:** ledger range becomes committed, `finalizedRowsSinceEntry` increases by `prepared.lines.length`, and each staged normalized component snapshot becomes the committed snapshot.

**POST:** logical frontier and mutation evidence advance only after successful write.

**Untraced:** none under the extracted PRE.

### 2.7 `preflight` — **PROVEN**

Source: `managed-renderer.ts:153-159`.

CFG is exhaustive and ordered:

- stopped → `"TUI is stopped"`;
- either force sentinel `-1` → `"native force render was requested"`;
- changed tool expansion → `"tool expansion changed"`;
- visible overlay → overlay reason;
- otherwise `undefined`.

This matches documented native-transition causes. Persistent hidden overlays remain managed because the official `hasOverlay()` semantics are assumed to mean visible overlay.

**Untraced:** none in local CFG; the visibility meaning of `hasOverlay()` is an official-source dependency.

### 2.8 `assertCommittedSnapshots` — **PROVEN** under deterministic-render PRE

Source: `managed-renderer.ts:161-166`.

Loop invariant after `k` entries: the first `k` committed components normalize exactly to their stored snapshots. A length mismatch or any indexed byte mismatch throws; completion proves all stored committed components are unchanged. The finite map size is the variant.

**Untraced:** official component render purity/determinism and normalization.

### 2.9 `captureInitialCommittedSnapshots` — **PROVEN** under baseline PRE

Source: `managed-renderer.ts:168-173`.

For each ledger item, noncommitted items take the continue edge and cause no write. Every committed item contributes one normalized snapshot per component. Finite item/component counts terminate both loops.

**POST:** map domain is exactly all currently committed component identities.

### 2.10 `cancelPrepared` — **PARTIAL**

Source: `managed-renderer.ts:175-180`.

Valid-token path restores prepared items to live. Throw path is swallowed, leaving an unknown prepared state. The design calls cancellation best-effort on poisoned recovery but also states that a pre-write exception cancels preparation. Because this function suppresses failure, it cannot establish the unconditional latter POST.

**Untraced line:** empty catch at line 178.

### 2.11 `state` — **PROVEN**

Source: `managed-renderer.ts:182-193`.

No-frame branch throws. Frame-present branch returns the current frame, stable rows/known flag, displacement, and finalized-row count. In every successful `render` outcome that calls `state`, line 126 has already installed a frame, so the throw is unreachable from those call sites.

---

## 3. Natural strongest-postcondition proof: `transcript-ledger.ts`

### 3.1 `add` — **PROVEN**

Source: `transcript-ledger.ts:31-52`.

- Duplicate-id branch throws before mutation.
- `committed && !finalized` throws before mutation.
- A baseline committed item after any noncommitted item throws, preserving prefix invariant.
- Success constructs exactly one item, with optional component singleton, correct finality/commit state, appends it, and increments revision once.

Given `L` and a component not already owned, success preserves `L`. Component uniqueness is a caller PRE; `add` itself does not search component ownership.

### 3.2 `attach` — **PROVEN** under `L`

Source: `transcript-ledger.ts:54-62`.

Unknown id throws via `requireItem`. If the component belongs to another item, it throws. If absent from this item, it appends; if already present, component array is unchanged. Both success branches increment item render revision and ledger revision exactly once. Identity uniqueness is preserved.

### 3.3 `finalize` — **PROVEN**

Source: `transcript-ledger.ts:64-70`.

Unknown id throws. Already-finalized branch is an idempotent no-op. Pending branch changes only `finality` to finalized and increments revision. Order, ownership, and frontier remain unchanged, preserving `L`.

### 3.4 `reorderByComponents` — **PROVEN** under documented reconciliation PRE

Source: `transcript-ledger.ts:72-99`.

- Prepared-ledger branch throws before mutation.
- `rank` records chat identity order; documented PRE requires identities unique.
- `prefixLength` identifies the committed prefix.
- Loop invariant: every visited committed component exists in chat and has rank strictly greater than all previous committed components. Disappearance/order change throws before reorder.
- Each suffix item receives minimum component rank, or infinity if unattached/absent. Stable numeric sort by rank then original index preserves relative ties.
- Changed-order branch installs the new suffix order and increments revision; unchanged branch does neither.

Committed prefix identity and order remain unchanged. The suffix follows visible component rank without allowing a committed crossing.

### 3.5 `prepareCommit` — **PROVEN**

Source: `transcript-ledger.ts:101-129`.

- Existing-prepared branch throws.
- First loop invariant: all indices `< first` are committed; variant `items.length-first` decreases.
- Second loop invariant: `[first,end)` contains only finalized nonempty items and `lines` is exactly the concatenation of their render results. Pending/finality-empty/end branches stop at the maximal frontier.
- Empty-range branch returns `undefined` without mutation.
- Success captures current revision, exact range, ids, and rendered lines; only after all rendering succeeds does it mark the range prepared and install the token.

Thus render failure leaves ledger state unchanged and later finalized items cannot cross a pending/empty frontier item.

### 3.6 `commitPrepared` — **PROVEN**

Source: `transcript-ledger.ts:131-138`.

**PRE:** valid current token and successful terminal write. `assertPrepared` either throws before mutation or establishes current identity/revision/range ids. The loop commits exactly the prepared half-open range; then the prepared token is cleared and revision increments. Since preparation admitted only finalized items at the frontier, `L` is preserved and frontier advances to `endExclusive`.

### 3.7 `cancelPrepared` — **PROVEN**

Source: `transcript-ledger.ts:140-147`.

Valid token establishes exact range; loop restores precisely that range to live; token is cleared; finality/order/revision/frontier are unchanged. Invalid token throws before mutation.

### 3.8 `liveItems` — **PROVEN**

Source: `transcript-ledger.ts:149-151`. Returned sequence is exactly all items whose commit state is not committed, preserving source order.

### 3.9 `allItems` — **PARTIAL**

Source: `transcript-ledger.ts:153-155`. It returns the internal array itself. TypeScript’s `readonly` return type prevents ordinary typed mutation but provides no runtime immutability. A JavaScript caller or cast can mutate item objects/array without revision changes, defeating token and invariant checks. The design describes immutable token observations but does not authorize exposing mutable ledger storage.

**Untraced line:** line 154’s alias escape.

### 3.10 `item` — **PROVEN**

Source: `transcript-ledger.ts:157-159`. Finite `find` returns the first matching id or undefined; uniqueness in `L` makes it the unique matching item.

### 3.11 `itemForComponent` — **PROVEN**

Source: `transcript-ledger.ts:161-163`. Finite `find` returns the unique owner or undefined under component-identity uniqueness.

### 3.12 `reset` — **PROVEN**

Source: `transcript-ledger.ts:165-169`. Items become empty, prepared becomes absent, and revision increments. Empty ledger satisfies `L` with frontier zero.

### 3.13 `requireItem` — **PROVEN**

Source: `transcript-ledger.ts:171-175`. Missing branch throws with id; present branch returns the unique item.

### 3.14 `assertPrepared` — **PARTIAL**

Source: `transcript-ledger.ts:177-185`.

Identity/revision mismatch throws. Matching identity/revision computes current ids and throws on any indexed mismatch; completion proves identity, revision, and listed ids still match.

**Gap:** because `allItems()` aliases mutable storage, external mutation can alter `commitState`, `finality`, components, or token `itemIds` without revision change. `assertPrepared` does not recheck that every range item remains `prepared` and finalized. This is a hidden encapsulation assumption, so the proof is not closed.

---

## 4. Natural strongest-postcondition proof: `component-ledger-reconciler.ts`

### 4.1 `initialize` — **PROVEN** under attested-prefix PRE

Source: `component-ledger-reconciler.ts:20-35`.

Reset establishes empty `L`. Loop invariant after `k` chat children: exactly the first `k` children have one ledger representation in chat order; baseline members encountered so far are committed/finalized; known static members are finalized; other members are opaque/pending. `TranscriptLedger.add` rejects a non-prefix `baselineCommitted` set. Finite child count terminates.

### 4.2 `beginAssistant` — **PARTIAL**

Source: `component-ledger-reconciler.ts:37-41`.

SP is one fresh pending, unattached assistant item and `currentAssistantId` pointing to it. Freshness follows monotonically increasing sequence.

**Hidden assumption:** lifecycle never calls `beginAssistant` while another current assistant is unresolved. The function overwrites `currentAssistantId` without rejecting or finalizing the old item. This assumption is plausible for Pi’s serial assistant lifecycle but is not established locally.

### 4.3 `ensureTool` — **PROVEN**

Source: `component-ledger-reconciler.ts:43-46`. Existing-id branch is a no-op. Missing branch adds one pending unattached tool with deterministic tool-call id. Ledger id uniqueness is preserved.

### 4.4 `completeAssistant` — **PARTIAL**

Source: `component-ledger-reconciler.ts:48-57`.

If a current id exists it is finalized; current id is always cleared. False `completePendingTools` leaves tools unchanged. True branch finalizes every tool item idempotently.

**Hidden assumption:** the caller passes `completePendingTools=true` only when lifecycle evidence proves every outstanding tool complete. Without that official event contract, finalizing all tool items would violate the “finality only from evidence” invariant.

### 4.5 `completeTool` — **PROVEN**

Source: `component-ledger-reconciler.ts:59-62`. Ensures a unique tool item exists and finalizes it. The operation is idempotent.

### 4.6 `reconcile` — **PROVEN** under documented unique-chat/lifecycle PRE

Source: `component-ledger-reconciler.ts:64-99`.

First loop invariant after `k` children: each of the first `k` visible identities has exactly one ledger owner.

- Existing owner: continue.
- Tool shape: ensure tool, attach identity, continue.
- Assistant shape: select earliest unattached assistant item; absent binding evidence throws; present item receives component.
- Other shape: add known static finalized or unknown opaque pending.

Second loop finalizes exactly pending opaque items whose component is no longer the chat tail. This is the documented opaque-tail evidence rule. Final reorder verifies committed presence/order and stably reorders only suffix items to chat rank.

**POST:** every visible child is uniquely represented, committed prefix is unchanged, suffix order matches chat order, and non-tail opaque items are finalized.

**Official dependency:** `toolCallIdOf` and `isAssistantComponent` must soundly classify Pi component shapes.

### 4.7 `firstManagedComponent` — **PARTIAL**

Source: `component-ledger-reconciler.ts:101-103`.

It finds the first noncommitted **item** and returns only that item’s first component. If that frontier item is lifecycle-created but not yet attached, it returns undefined even when a later noncommitted visible item has a component. The design asks width re-entry to locate the earliest noncommitted ledger **component**. Whether undefined is safe depends on native-entry caller fallback logic outside the target and was not established here.

**Untraced expression:** optional `components[0]` after item-level `find`.

### 4.8 `reset` — **PROVEN**

Source: `component-ledger-reconciler.ts:105-108`. Ledger becomes empty and current assistant binding clears. Monotonic id sequences intentionally remain monotonic, avoiding id reuse in a run.

### 4.9 `isStatic` — **PARTIAL**

Source: `component-ledger-reconciler.ts:110-112`. It returns membership of runtime `component.constructor.name` in the fixed documented component-name set. Local CFG is total.

**Hidden assumption/official dependency:** official Pi component constructor names are stable, unminified, and exhaustive for the recognized static classes. A rename silently changes finality from static/finalized to opaque/pending; this module performs no ABI check.

---

## 5. `managed-render-content.ts`

### `renderManagedContent` — **PROVEN**

Source: `managed-render-content.ts:11-24`.

The chained map at lines 12–14 preserves ledger order, component order within each item, and line order within each render; committed items are excluded by `liveItems`. Returned trailing sections render `beforeEditor`, Editor, `afterEditor`, and Footer separately in that semantic order. No mutation is performed by this function itself.

**POST:** intrinsic rows are partitioned exactly as required for the volatile priority algorithm.

**Official dependency:** `Component.render(width)` and `renderComponents` must preserve Pi’s native component semantics and be pure for a render transaction.

---

## 6. `volatile-region.ts`

### 6.1 `volatileLiveCapacity` — **PROVEN**

Source: `volatile-region.ts:18-27`.

Invalid nonpositive/noninteger height throws. Let `M=|editor|+|footer|`. If `M>height`, undefined is returned. Otherwise remaining starts at `height-M`, then subtracts `min(|after|,remaining)`, then `min(|before|,remaining)`. Each subtraction preserves `remaining≥0`. Final value is exactly transcript capacity after mandatory, after-editor, and before-editor priorities.

### 6.2 `takeTail` — **PROVEN**

Source: `volatile-region.ts:29-31`. `capacity≤0` returns empty; positive capacity returns exactly the last at most `capacity` rows, preserving order.

### 6.3 `renderVolatileRegion` — **PROVEN**

Source: `volatile-region.ts:33-61`.

Invalid height throws. Mandatory-overflow branch returns exactly `height` empty rows and `requiresNativeFallback=true`.

Success-path arithmetic:

```text
r0 = height-|editor|-|footer| ≥ 0
|after|taken ≤ r0
r1 = r0-|afterTaken| ≥ 0
|before|taken ≤ r1
r2 = r1-|beforeTaken| ≥ 0
|live|taken ≤ r2
r3 = r2-|liveTaken| ≥ 0
```

Concatenated length is `|liveTaken|+|beforeTaken|+|editor|+|afterTaken|+|footer|+r3 = height`. Slack is appended only after Footer. All optional sections are tails; Editor/Footer are complete. Every branch satisfies the volatile-region contract.

---

## 7. `live-region-growth.ts`

### `planLiveRegionGrowth` — **DISPROVEN**

Source: `live-region-growth.ts:8-18`.

Invalid overflow throws. On success, lines 10–11 compute only

```text
down=min(overflow, terminalHeight-bottom)
nextBottom=bottom+down
```

and line 13 keeps `top` unchanged. `buildViewportExpansion(area.top,area.top)` also represents no top expansion.

**Concrete counterexample:** valid `area={width:80,terminalHeight:10,top:3,bottom:10,height:7}`, `overflowRows=2`. The function returns the same `[3,10)` area. Both design variants require at least one upward row because downward capacity is zero and `top=3` has safe capacity above it. Hence the strongest postcondition is strictly weaker than `GR`; the function is false against the specification.

**Untraced:** no branch implements remaining overflow or small-top fallback.

---

## 8. `managed-height-rebase.ts`

### `rebaseManagedHeight` — **PROVEN**

Source: `managed-height-rebase.ts:3-10`.

Invalid terminal height or mandatory row count throws. For valid inputs:

```text
nextBottom=min(old.bottom,terminalHeight)
nextTop=min(old.top,max(0,nextBottom-mandatoryRows)).
```

Because `old.bottom>old.top≥0`, valid reachable resize states ensure `nextBottom>0`; `nextTop<nextBottom`. `createInlineViewportArea` then proves `G`. The chosen top reserves up to all available rows needed for mandatory content without moving bottom beyond the new terminal. If mandatory content exceeds the whole terminal, the returned full available area allows the later volatile-capacity check to request fallback. Height growth does not eagerly expand bottom, consistent with demand-driven geometry.

---

## 9. `inline-viewport-area.ts`

### `createInlineViewportArea` — **PROVEN**

Source: `inline-viewport-area.ts:9-23`.

The four guards exhaust invalid width, terminal height, top, and bottom cases. The default `bottom=terminalHeight` is evaluated before validation. On success all quantities are integers, width/height positive, `0≤top<bottom≤terminalHeight`, and returned `height=bottom-top`; therefore `G` holds exactly.

---

## 10. `inline-viewport-frame.ts`

### `createInlineViewportFrame` — **DISPROVEN**

Source: `inline-viewport-frame.ts:15-28`.

Wrong row count throws. Cursor guard rejects negative/out-of-row-range row and negative column. Success clones rows and returns the supplied cursor/visibility.

**Concrete counterexample:**

```text
area={width:10,terminalHeight:5,top:0,bottom:2,height:2}
rows=["a","b"]
cursor={row:0,column:10}
```

The design says cursor is area-relative and must be in bounds. Valid columns for a width-10 area are `0..9`; column 10 is outside. The guard checks only `column<0`, so the function returns an invalid frame. It also accepts fractional/NaN row or column values because integer/finite checks are absent.

**Untraced lines:** lines 21–23 omit `column < area.width` and numeric-integrality checks.

---

## 11. `screen-frame-diff.ts`

### 11.1 `moveTo` — **PROVEN** under integer coordinate PRE

Source: `screen-frame-diff.ts:3-5`. For zero-based nonnegative integer `(row,column)`, string interpolation yields ANSI CUP at one-based `(row+1,column+1)`, exactly the coordinate conversion used by physical-frame and cursor contracts.

### 11.2 `diffInlineViewport` — **DISPROVEN**

Source: `screen-frame-diff.ts:7-20`.

Width mismatch throws. For every next-frame row, it computes absolute row and previous-relative row. Equal overlapping bytes take the no-write edge; all other rows append CUP + `CSI 2K` + next bytes. Thus every row **owned by next** is correctly diffed and unchanged overlap is not repainted.

The loop never visits rows owned only by `previous`.

**Concrete counterexample:**

```text
previous.area=[top=1,bottom=4), width=5, terminalHeight=6
previous.rows=["A","B","C"]
next.area=[top=1,bottom=3), width=5, terminalHeight=6
next.rows=["A","B"]
```

Both are valid frames and equal-width top/bottom changes are explicitly permitted by `physical-frame.md`. The function emits `""`, leaving `"C"` physically visible at absolute row 3. But `[next.bottom,terminalHeight)` is defined as unused native blank space, so the physical terminal no longer equals the next frame composition. A required erase for the relinquished bottom row is absent.

This path may be unreachable in the current growth-only epoch except during a physical height shrink (where the terminal itself removes rows), but the documented helper contract permits top/bottom changes without that hidden monotonicity restriction. The function is therefore not proven as specified.

### 11.3 `paintInlineViewport` — **PROVEN** under entry-blank PRE

Source: `screen-frame-diff.ts:22-29`. Loop invariant after `k` rows: the first `k` frame rows have an absolute CUP, full-line erase, and exact next bytes in output. Finite frame height terminates. The result paints every owned row exactly once without CRLF. The native-entry contract supplies the needed PRE that rows below a short initial area are already blank; this function intentionally does not clear them.

---

## 12. `terminal-render-plan.ts`

### `buildTerminalRenderPlan` — **PROVEN**

Source: `terminal-render-plan.ts:7-11`.

All-empty branch returns empty output and performs no pointless synchronized-update toggle. Every nonempty combination returns exactly one `CSI ?2026h`, then history, frame, cursor in required order, then exactly one `CSI ?2026l`. Cursor is therefore transaction-last. No reordering or CRLF is introduced here.

---

## 13. `cursor-placement.ts`

### `buildCursorPlacement` — **PROVEN** under `F(frame)`

Source: `cursor-placement.ts:4-9`.

Absent-cursor branch emits hardware-cursor hide. Present branch computes absolute row `area.top+cursor.row` and passes relative column to CUP. True visibility appends show; false appends hide. Thus placement is area-relative-to-absolute and visibility matches frame policy.

This proof requires a valid frame. Because `createInlineViewportFrame` is disproven, arbitrary values returned by that constructor do not automatically establish this PRE.

---

## 14. `stable-screen-rows.ts`

### 14.1 `constructor` — **PARTIAL**

Source: `stable-screen-rows.ts:11-17`.

For a nonnegative integer capacity and `rows.length≤capacity`, success keeps at most the last `capacity` rows and sets `known` only if caller attests known and the retained rows fill capacity. Capacity zero forces empty rows. Thus `S` follows under the design-derived geometry PRE.

**Untraced validation:** the guard rejects only `capacity<0` and excess rows. It accepts `NaN`, fractions, and infinity, although capacities originate from integer `area.top` in valid internal calls. The class does not enforce that hidden origin.

### 14.2 `rows` — **PARTIAL**

Source: `stable-screen-rows.ts:19-21`. It returns the current row array by reference. Typed callers see `readonly`, but runtime callers can mutate it, breaking `S` without revision increment. A closed proof requires the hidden assumption that all consumers honor TypeScript readonly and do not cast/alias-mutate.

### 14.3 `previewAppend` — **PROVEN**

Source: `stable-screen-rows.ts:23-28`. Returned token records current revision and contains empty rows at zero capacity or the last `capacity` rows of current rows followed by appended lines. Therefore preview length is at most capacity and order is suffix-preserving. State is unchanged.

### 14.4 `accept` — **PROVEN** for an authentic unmodified preview; otherwise **PARTIAL** as public API

Source: `stable-screen-rows.ts:30-35`.

Stale revision throws before mutation. For a token produced by `previewAppend` at the current revision and not externally mutated, rows are cloned into state and revision increments, preserving `S`.

**Untraced capability assumption:** `StableScreenPreview` is a structural exported type. A caller can forge `{baseRevision: current, rows: oversizedRows}` or mutate the preview’s aliased array before acceptance; `accept` does not enforce `rows.length≤capacity`. The design treats previews as transaction-owned capabilities, but the implementation does not enforce that boundary.

---

## 15. Hidden assumptions and official-source dependencies

These are not silently added to PREs. They are explicit proof obligations outside the thirteen targets.

| Dependency/assumption | Used by | Required property | Proof status here |
|---|---|---|---|
| `@earendil-works/pi-tui` `Component.render(width)` | renderer, reconciler content, snapshots | synchronous, deterministic within a transaction, no lifecycle/terminal side effects, stable component identity | Unproved official-source dependency |
| Pi component constructor names | `isStatic` | exact stable names for five recognized static classes; not minified/renamed | Unproved ABI dependency |
| `isAssistantComponent`, `toolCallIdOf` | reconciler | sound and complete structural classification | Unproved local dependency outside targets |
| `TuiInternals.terminal.columns/rows/write` | renderer | dimensions are current; `write` is sole owner write; return is the software acceptance boundary | Unproved official/private ABI; physical atomicity explicitly not guaranteed |
| `previousWidth`, `previousHeight` sentinel | `preflight` | `-1` exactly means native force render requested | Unproved official/private ABI |
| `hasOverlay()` | `preflight` | true exactly for a visible overlay; persistent hidden overlays return false | Unproved official/private ABI |
| `showHardwareCursor` | frame/cursor | matches Pi cursor policy | Unproved official/private ABI |
| `normalizeLines`, `normalizeViewportLines` | renderer/snapshots | row-width normalization preserves intended visible bytes; viewport normalization returns exact area height and valid cursor | Unproved local dependency outside targets |
| `renderComponents` | managed content | preserves component and line order | Unproved local dependency outside targets |
| `buildViewportExpansion` | growth | `(top,top)` means no history/scroll bytes | Unproved local dependency outside targets; consistent with removed manual history insertion |
| Native entry baseline | constructor/paint | initial frame equals physical owned cells; rows below short `bottom` are blank; stable rows are attested | Proved only by separate design argument, not reverified implementation here |
| Single-threaded render transaction | ledger preparation | no lifecycle mutation occurs between prepare and commit/cancel | Hidden runtime assumption; ledger methods permit revision-changing calls while prepared |
| Readonly discipline | ledger/stable getters and preview tokens | no JS/cast mutation of aliased arrays/items/tokens | Hidden encapsulation assumption, not runtime-enforced |
| Terminal interpretation | diff/cursor/plan | CUP/EL2/synchronized-update sequences have standard semantics and printable row strings contain no control flow that changes cursor unexpectedly | External terminal dependency |

The design itself also records residual boundaries that cannot be proven by these functions: partial terminal writes, hard process death during a write, direct third-party `process.stdout` writers, Apple Terminal IME/SIGSEGV behavior, and untested terminal/multiplexer matrices.

---

## 16. Test evidence disposition

`docs/design/detail/verification-plan.md` and `docs/design/proofs/scco-composition.md` report 59 tests/12 suites, TypeScript success, and a Global Pi 0.83.0 tmux smoke. The discovered current repository contains additional test files including `fixed-frame.test.ts`, `managed-runtime.test.ts`, `demand-driven-runtime.test.ts`, `resize-epoch.test.ts`, `terminal-plan.test.ts`, and `transcript-ledger.test.ts`, plus runtime/snapshot tests.

Those reports support plausibility but cannot discharge the counterexamples:

- A passing growth test that covers only downward capacity does not cover bottom-saturated upward growth.
- A passing diff test over equal or expanding areas does not cover relinquished bottom rows.
- TypeScript cannot reject a runtime out-of-width cursor passed to the frame constructor.
- Test coverage cannot turn aliased mutable storage into an invariant-preserving capability.

Because direct test bodies were not fully read in this run, no claim is made about whether a current test already encodes or misses each counterexample.

---

## 17. SCCO Optimization

### Sound

The composition is sound only for the subset where:

```text
valid native-seeded entry
∧ ledger/reconciler hidden dependencies hold
∧ demanded growth fits below current bottom
∧ viewport ownership never shrinks at the bottom without terminal clipping
∧ every constructed cursor is truly in bounds
∧ no aliased token/state is mutated
∧ terminal.write returns normally.
```

Within that subset, the proof establishes:

- ledger commit order is a maximal finalized source-order prefix;
- volatile layout preserves Editor/Footer and bottom-only slack;
- ordinary row writes use absolute CUP/EL2 and no CRLF;
- cursor bytes are last in one synchronized terminal plan;
- memory acceptance occurs after the software write boundary;
- write failure does not accept geometry/frame/frontier or resend.

The unconditional SCCO “Sound” claim in `docs/design/proofs/scco-composition.md` is not established because the growth lemma used by that composition is false in the implementation, and shrinking-bottom physical equality is not maintained by the diff helper.

### Complete

Not complete against the stated implementation contract:

1. Bottom-saturated upward growth CFG is absent.
2. Relinquished previous-frame rows have no erase path.
3. Frame cursor validation omits horizontal upper bound and numeric validity.
4. Test bodies were not independently traversed in this run.
5. The design’s own terminal/IME, hard-SIGKILL, partial-write, and foreign-writer residuals remain.

### Concise

The decomposition remains conceptually concise: geometry, ledger, reconciliation, intrinsic rendering, volatile selection, frame diff, terminal plan, cursor, and handoff evidence are separate. However, `ManagedRenderer.render` currently composes a growth helper whose POST is weaker than the renderer proof assumes. The minimal correction is at the geometry helper/caller boundary, not a broader TUI rewrite.

### Optimization

The design’s optimization conclusion remains directionally justified: component-only replacement cannot control physical leakage, full-screen takeover needs an origin it does not possess, and rewriting Pi’s TUI is outside scope. A DSR-derived bounded inline owner is the smallest documented architecture that can satisfy the goals.

The implementation is not yet the optimum **correct** realization because omitted upward growth trades away specified capacity and causes premature transcript cropping. The minimal repair surface is:

- implement remaining-overflow upward growth in `planLiveRegionGrowth`, with the design resolving its `top-2` versus no-history-insertion small-top rule;
- either constrain/document `diffInlineViewport` to reachable monotone areas or erase previous-only bottom rows;
- enforce `0≤cursor.column<area.width` and finite integer cursor coordinates;
- make ledger/stable observations and preview tokens non-aliasing or validate them on acceptance.

These changes preserve the chosen architecture and avoid adding new responsibilities.

---

## 18. Final classification

### DISPROVEN

- `ManagedRenderer.render` — `managed-renderer.ts:73-133`: delegates to a growth function that violates the upward-growth contract; also does not rollback reconciliation on a later pre-write failure.
- `planLiveRegionGrowth` — `live-region-growth.ts:8-18`: no upward-growth branch.
- `createInlineViewportFrame` — `inline-viewport-frame.ts:15-28`: accepts horizontally out-of-bounds/nonintegral cursors.
- `diffInlineViewport` — `screen-frame-diff.ts:7-20`: does not clear previous-only rows when bottom shrinks.

### PARTIAL

- `ManagedRenderer.constructor`, `snapshotDetails`, `prepareCommit`, `cancelPrepared`.
- `TranscriptLedger.allItems`, `assertPrepared`.
- `ComponentLedgerReconciler.beginAssistant`, `completeAssistant`, `firstManagedComponent`, `isStatic`.
- `StableScreenRows.constructor`, `rows`, and public-capability aspect of `accept`.

Every partial classification above lists its untraced line or dependency. No skipped path is labeled proven.

### PROVEN under stated extracted PREs

- `ManagedRenderer.beginDrain`, `acceptPrepared`, `preflight`, `assertCommittedSnapshots`, `captureInitialCommittedSnapshots`, `state`.
- `TranscriptLedger.add`, `attach`, `finalize`, `reorderByComponents`, `prepareCommit`, `commitPrepared`, `cancelPrepared`, `liveItems`, `item`, `itemForComponent`, `reset`, `requireItem`.
- `ComponentLedgerReconciler.initialize`, `ensureTool`, `completeTool`, `reconcile`, `reset`.
- `renderManagedContent`.
- `volatileLiveCapacity`, `takeTail`, `renderVolatileRegion`.
- `rebaseManagedHeight`.
- `createInlineViewportArea`.
- `moveTo`, `paintInlineViewport`.
- `buildTerminalRenderPlan`.
- `buildCursorPlacement` with `F(frame)`.
- `StableScreenRows.previewAppend`, and `accept` for an authentic unmodified current preview.

**Overall Round 005 renderer verdict: DISPROVEN.** The source-order ledger and volatile priority core are locally sound, but the active-renderer composition does not satisfy the documented variable-area growth contract on a bottom-saturated viewport, and the general frame diff does not preserve physical-frame equality when ownership shrinks.