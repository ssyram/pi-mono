# HoarePrompt Lifecycle Proof — codex-viewport Round 005

## Review

- **Correct:** Normal entry, managed activation, width recapture, native commit, handoff, shutdown, and identity-guarded release are coherent under their intended event-order preconditions. The implementation uses generation, patch identity, phase, and abort-controller identity to prevent stale asynchronous activation (`runtime-coordinator.ts:55-101,169-204`).
- **Blocker:** `startRun()` is not ownership-safe outside `idle-native`. From `active-managed`, its phase guard changes only the phase to `active-native-fallback`; it neither detaches nor recovers the active patch (`runtime-coordinator.ts:49-54,216-219`). The TUI therefore remains managed while the coordinator claims native fallback. A later `finishRun()` sets `idle-native` without releasing that patch (`runtime-coordinator.ts:118-135`). Verdict: **DISPROVEN**.
- **Blocker:** `finishRun()` is not idempotent and `disposed` is not absorbing. A second call while `draining-handoff` falls through to `idle-native` without disposing the patch; a call after `shutdown()` changes `disposed` to `idle-native` (`runtime-coordinator.ts:118-152`). Verdict: **DISPROVEN**.
- **Note:** `capture()` suppresses every exception while restoring the prior patch and then reports a phase derived only from the new context (`runtime-coordinator.ts:22-46`). Method ownership is normally released before recovery, but failed terminal/native restoration is neither surfaced nor notified. Verdict: **PARTIAL**.
- **Note:** The design phase list omits `native-commit-gate`, although source defines and uses it (`docs/design/detailed-design.md`, lifecycle phase section; `runtime-phase.ts:1-9`; `runtime-coordinator.ts:166-188`). Source is authoritative here.
- **Note:** Tests were read, not executed during this review. Existing tests cover normal activation, delayed-entry cancellation, fallback, width re-entry, native commit failure, stop/shutdown recovery, and selected handoff paths, but not the two blocker traces above.

## 1. Proof model

### 1.1 State

Let coordinator state be:

`C = <phase, generation, tui, patch, entryAbort, registerInput, getToolsExpanded, notify>`.

Let installed patch state be:

`P = <enabled, renderer, reconciler, nativeFrameCurrent, gateRenderPending, rendering, renderPending, snapshotOwner>`.

Let TUI ownership be:

- `N`: no own `doRender`/`stop`; prototype/native Pi methods own rendering.
- `M(P)`: own methods equal `P.patchedDoRender` and `P.patchedStop`, and owner marker equals `P`.
- `X`: one or more properties have been replaced by another owner.

Predicates:

- `Current(g,p) ≜ C.generation = g ∧ C.patch = p`.
- `EntryCurrent(g,a) ≜ C.generation = g ∧ C.entryAbort = a`.
- `RecaptureCurrent(g,p,a,q) ≜ Current(g,p) ∧ C.phase = q ∧ C.entryAbort = a`.
- `PatchActive(P) ≜ P.enabled ∧ P.renderer ≠ undefined` (`runtime-patch.ts:81`).
- `ManagedPhase(q) ≜ q ∈ {active-managed,width-recapture-gate,native-commit-gate,draining-handoff}` (`runtime-coordinator.ts:221-227`).

### 1.2 NSP convention

`NSP(S, Q)` denotes the normal strongest postcondition of statement/range `S` from precondition `Q`. Exceptional exits are listed separately. Calls to imported functions are proved modularly from the source inspected; where an imported renderer/component implementation was outside this lifecycle trace, its exception is denoted `Eexternal` and listed as untraced rather than assumed away.

Status meanings:

- **PROVEN:** every local normal and exceptional exit is accounted for under the stated PRE.
- **PARTIAL:** proof depends on a caller/environment condition not locally established, or an external callback path lacks local containment.
- **DISPROVEN:** a concrete source trace violates the claimed lifecycle/ownership postcondition.

## 2. Owner-uniqueness proof

### 2.1 Installation

PRE: `tuiInternals(tui)` succeeds; TUI is extensible; no owner marker; neither `doRender` nor `stop` is own; supported terminal/layout; no visible overlay.

1. Preflight rejects every failure of that conjunction (`runtime-patch-preflight.ts:11-24`).
2. No `await` occurs between successful preflight and constructor property installation (`runtime-patch.ts:202-213`), so JavaScript run-to-completion prevents a second conforming installer from interleaving.
3. Constructor captures inherited/current native methods, installs two own wrappers, then writes the owner marker (`runtime-patch.ts:39-44`).
4. If any installation operation throws, the catch identity-restores all properties installed so far and rethrows (`runtime-patch.ts:44-48`).

POST on success: `M(P)` and the captured original methods are the only native handoff targets. POST on constructor failure, assuming the newly defined properties remain configurable: `N`.

### 2.2 Release

`restoreRuntimePatchMethods` deletes each property only if its current value is the patch-owned identity (`restore-runtime-patch-methods.ts:5-13`). Therefore it never deletes a later owner `X`. All explicit disposal/recovery/gate-return branches set `enabled = false` before or with restoration (`runtime-patch.ts:58-80`).

Qualification: `Reflect.deleteProperty` returns `false` rather than throwing for a matching non-configurable property, and the return is ignored (`restore-runtime-patch-methods.ts:11-13`). The constructor created configurable properties, so normal callers establish deletability. An external descriptor mutation can leave a disabled wrapper installed. This is **PARTIAL**, not an unconditional restoration proof.

### 2.3 Asynchronous uniqueness

- `cancelCurrentEntry` increments `generation` before aborting and detaching (`runtime-coordinator.ts:197-204`).
- Initial entry checks generation/controller currentness before baseline construction and again before activation (`managed-entry.ts:18-38`; coordinator closure at `runtime-coordinator.ts:83-101`).
- Recapture additionally checks patch identity, gate phase, and exact abort-controller identity (`runtime-coordinator.ts:169-188`; `begin-width-recapture.ts:14-28`).
- Returned-native callbacks require matching generation and patch identity (`runtime-coordinator.ts:206-214`).

Thus stale asynchronous work cannot reactivate a cancelled patch under normal callback behavior.

### 2.4 Counterexample to global uniqueness invariant

Trace:

1. `C.phase = active-managed`, `C.patch = P`, `M(P)`, `PatchActive(P)`.
2. Call `startRun()` again.
3. Guard `phase !== idle-native` invokes `enterFallback`, changing only `phase` (`runtime-coordinator.ts:49-54,216-219`).
4. Result: `C.phase = active-native-fallback ∧ C.patch = P ∧ M(P) ∧ PatchActive(P)`.

This violates the natural invariant `phase ∈ native phases ⇒ no active managed owner`. Global owner/phase uniqueness is therefore **DISPROVEN** unless the caller supplies and maintains the unverified precondition “`startRun` occurs at most once and only from `idle-native`.”

## 3. RuntimePhase transition matrix

Cells show direct or asynchronous destinations. `—` means no intended transition in source. `!` marks a disproven/unsafe edge.

| From | `capture` | `startRun` / completion | `finishRun` | width/native recapture | returned callback | `shutdown` |
|---|---|---|---|---|---|---|
| `idle-native` | `idle-native` or `active-native-fallback` | `entering-managed` → `active-managed` / fallback / cancelled | `idle-native` | — | stale ignored | `disposed` |
| `entering-managed` | idle/fallback; old entry invalidated | no-op | `idle-native` after recovery | — | `active-native-fallback` | `disposed` |
| `active-managed` | idle/fallback after recovery | **! `active-native-fallback` while patch stays active** | `draining-handoff` | gate | returned → fallback | `disposed` |
| `width-recapture-gate` | idle/fallback via clean/dirty gate return | **! fallback without release** | `idle-native` | `active-managed` or fallback | fallback | `disposed` |
| `native-commit-gate` | idle/fallback via gate return | **! fallback without release** | `idle-native` | `active-managed` or fallback | fallback | `disposed` |
| `draining-handoff` | idle/fallback after recovery | **! fallback without release** | **! `idle-native` without release on repeated call** | — | seamless → idle; mismatch → fallback | `disposed` |
| `active-native-fallback` | idle/fallback | remains fallback | `idle-native` | — | stale/identity-dependent | `disposed` |
| `disposed` | may initialize a new captured session | fallback if prerequisites absent | **! `idle-native`** | — | stale ignored | `disposed` |

The source union itself is **PROVEN** to contain exactly eight literals (`runtime-phase.ts:1-9`). The transition system is **DISPROVEN** as a safe total state machine because native phases are not guaranteed to imply released ownership and `disposed` is not terminal.

## 4. `runtime-coordinator.ts` line-by-line NSP

### 4.1 Fields and `capture` (`15-47`) — PARTIAL

PRE: arbitrary prior coordinator state; `ctx` implements the captured session API.

- `15-20`: constructor field initializers establish `phase=idle-native`, `generation=0`, no optional owner/callback fields, and a fresh journal.
- `22-23`: event record has normal post `journal += session-capture`; journal failure is `Eexternal`.
- `24`: `cancelCurrentEntry` gives `generation'=generation+1`, aborts/clears entry controller, clears coordinator patch, and returns old patch.
- `25-29`: gate patches use `returnToNativeFromGate`; active patches use synchronous recovery; inactive patches dispose without redraw.
- `30`: every restoration exception is suppressed. NSP does not include successful physical native recovery.
- `32-33`: all context-specific references are cleared and notification is enabled only for UI contexts.
- `34`: no-UI branch establishes `phase=idle-native` and returns.
- `36-41`: UI accessors are captured; phase derives from `ctx.isIdle()`.
- `42-46`: any accessor/getTui exception is converted to the same phase choice; the exception is not reported.

POST: no old coordinator patch/controller ownership; new context references either initialized or cleared; phase is `idle-native` iff no UI or `ctx.isIdle()`, otherwise fallback. Missing guarantee: terminal/native restoration succeeded. Untraced: journal and context callback exceptions.

### 4.2 `startRun` (`49-102`) — DISPROVEN

PRE required for proof: `phase=idle-native ∧ tui/registerInput/getToolsExpanded defined`.

- `50`: `entering-managed` is idempotent no-op.
- `51-54`: every other invalid phase/prerequisite calls `enterFallback`. This is unsafe when an active patch already exists because ownership is untouched.
- `55-58`: valid entry sets gate phase, increments generation, and creates/owns an abort controller.
- `59-79`: patch installation callbacks close over exact generation and patch identity. Installation throw enters fallback with failure text.
- `80-81`: undefined patch enters fallback using preflight rejection reason.
- `82`: coordinator owns the installed patch.
- `83-91`: awaits managed entry. Matching controller is cleared afterward. Cancelled or stale completion performs no transition; activated completion establishes `active-managed`.
- `92-101`: failed entry calls synchronous recovery. Its `finally` clears matching patch ownership and converts a still-entering gate to fallback even if recovery throws.

Exceptional POST: a recovery exception propagates, but phase/patch cleanup from `finally` remains. Installation exceptions are contained. Counterexample is §2.4.

### 4.3 Phase/query/event forwarding (`104-117`) — PROVEN with callback exceptions

- `currentPhase` returns exactly `phase`.
- `noteEvent` appends the supplied journal record.
- Assistant/tool start/update/end methods record their lifecycle event and forward to the reconciler only when `observer()` is defined; `observer` itself is defined only in managed phases with a patch (`221-229`).
- Any journal/reconciler exception propagates; no phase mutation is performed locally.
- `snapshot` selects a target from current phase/TUI/patch and delegates execution. Its lifecycle state is unchanged locally; snapshot dependency failures propagate.

Untraced: reconciler and snapshot implementation internals.

### 4.4 `finishRun` (`118-136`) — DISPROVEN

PRE intended: exactly one call per run.

- `119`: records `agent-end`.
- `120-124`: `active-managed ∧ patch` → `draining-handoff`; `beginDrain` is requested. A synchronous `beginDrain` exception leaves this phase/owner intact.
- `125-133`: entering/gate phases cancel current ownership; initial entry recovers, recapture gates return native; `finally` guarantees `idle-native`.
- `135`: all other phases unconditionally become `idle-native` without inspecting/releasing `patch`.

Counterexamples:

- Repeated call in `draining-handoff` yields `idle-native` with live patch.
- Call in `disposed` resurrects `idle-native`.
- Call after the unsafe non-idle `startRun` trace can leave a live active patch under `idle-native`.

### 4.5 `shutdown` (`138-153`) — PROVEN

PRE: arbitrary coordinator state.

- Records shutdown, detects gate phase, then `cancelCurrentEntry` invalidates asynchronous work.
- Gate ownership returns natively; active patch recovers; inactive patch disposes.
- `finally` clears TUI, callbacks, notification, patch/controller references and establishes `phase=disposed` even if recovery throws.

POST normal or exceptional: `phase=disposed` and coordinator owns no patch/controller/context references. Physical recovery is not guaranteed on exceptional exit.

### 4.6 Recapture wrappers and `beginRecapture` (`155-188`) — PROVEN under caller callbacks

- Width wrapper chooses `width-recapture-gate`; native commit wrapper chooses `native-commit-gate` (`155-168`).
- `169-175` rejects stale generation, wrong phase, absent patch, or wrong patch identity.
- Missing input/tool accessors invokes failure handling before a controller is created.
- `176-184` sets the gate phase and begins recapture with an `isCurrent` predicate containing generation, phase, patch, and exact controller identity.
- Activation clears the matching controller and restores `active-managed`.
- Failure delegates to `failRecapture`.

Caller verification: both patch callbacks capture the exact `generation` and `patch` created by `startRun`; width/native callbacks are invoked only by that patch (`runtime-coordinator.ts:59-75`; `runtime-patch.ts:153-190`).

### 4.7 Failure/ownership helpers (`189-229`) — PROVEN/PARTIAL

- `failRecapture` (`189-193`): returns gate safely, clears controller and matching patch, then establishes fallback. **PARTIAL** because the exact physical native postcondition depends on gate return/native catch-up success.
- `handleWidthRedrawFailure` (`194-196`): matching generation/patch clears coordinator ownership and sets fallback; stale callback is ignored. **PROVEN**.
- `cancelCurrentEntry` (`197-204`): increments generation before abort; clears controller and patch; returns detached patch. Abort exceptions are not expected from platform `AbortController`. **PROVEN**.
- `handleReturned` (`206-214`): stale callback ignored; current callback aborts entry, clears patch, maps drain to idle and all other phases to fallback, optionally notifies recovery reason. **PROVEN**, notification callback exception untraced.
- `enterFallback` (`216-219`): phase becomes fallback and notification is emitted. It does not release ownership, which is the root of the `startRun` counterexample. **PROVEN as an assignment; unsafe as a transition primitive**.
- `isManaged`/`observer` (`221-229`): exact membership test and phase-gated reconciler lookup. **PROVEN**.

## 5. `runtime-patch.ts` line-by-line NSP

### 5.1 Constructor (`28-49`) — PROVEN under configurable-property PRE

PRE: successful preflight, no interleaving owner, ordinary data-property semantics.

- Captures native methods and callbacks (`36-41`).
- Defines own configurable/writable wrappers and assigns marker (`42-44`).
- On any throw, identity-restores installed portions and rethrows (`45-48`).

POST success: `enabled=true`, no renderer/reconciler, and `M(P)`. Exceptional POST: no patch-owned configurable property remains.

### 5.2 `activate`, `beginDrain`, `dispose` (`51-65`) — PROVEN/PARTIAL

- `activate`: disabled patch throws; otherwise installs renderer/reconciler, invalidates `nativeFrameCurrent`, and services a pending gate render. **PROVEN**; `requestRender` exception propagates after state assignment.
- `beginDrain`: calls renderer drain if present and requests render. **PARTIAL** on renderer/request callback exceptions.
- `dispose(true)`: delegates to synchronous native recovery. `dispose(false)` is idempotent; first call disables then identity-restores. **PARTIAL** only for the ignored failed deletion qualification in §2.2.

### 5.3 `recoverSynchronously` (`67-78`) — PROVEN

PRE: any patch state.

- Disabled patch is no-op.
- Enabled patch disables and restores before terminal/native recovery.
- Calls returned callback even if recovery returned an error.
- Preserves the first recovery error over callback error with `??=` and throws it.

POST normal: disabled, released under normal descriptor semantics, native redraw attempted unless stopped, callback called. Exceptional POST: same ownership poststate; first error propagates.

### 5.4 `returnToNativeFromGate` (`80-86`) — PARTIAL

Disabled is no-op. Enabled disables/restores; native catch-up occurs only if a render was suppressed and TUI is not stopped. A native render exception propagates after release. Correct for clean versus dirty gate, but physical native currency is conditional on the saved render succeeding.

### 5.5 Query/snapshot methods (`88-104`) — PROVEN/PARTIAL

- `isActive` exactly means enabled plus renderer present. **PROVEN**.
- `observer` returns current reconciler. **PROVEN**.
- `beginSnapshot` rejects inactive or incomplete renderer/reconciler state. Otherwise it leases the exact internals/state/render/request callbacks to the single-owner snapshot object. **PARTIAL** on snapshot-lease internals; duplicate lease rejection is implemented by `RuntimeSnapshotOwner.begin`.

### 5.6 Patched `stop` (`106-120`) — PROVEN

- Native-current gate: gate return is attempted and `onReturned` runs in its inner `finally`.
- Other states: synchronous native recovery is attempted.
- Saved original stop always runs in the outer `finally`.

Exception ordering: if original stop throws, its error overrides an earlier recovery/returned error under JavaScript `finally` semantics. Ownership is released before original stop in all enabled paths.

### 5.7 `render` (`122-140`) — PROVEN with external exceptions

- Active snapshot blocks render and records pending work.
- Reentry sets `renderPending` and returns.
- Outermost render sets `rendering`, invokes one `renderOnce`, and on an exception recovers only if still enabled.
- `finally` clears `rendering`; one coalesced render is requested if pending and still enabled.

A callback exception after a branch has already disabled the patch is swallowed by this catch (no second recovery). This matches the no-double-recovery rule but can hide an extension callback failure.

### 5.8 `renderOnce` (`142-198`) — PARTIAL

- Disabled → saved native render.
- No renderer → set dirty-gate bit, no terminal output.
- `rendered` → return.
- `width-changed` → clear renderer, call saved native renderer; on failure disable, best-effort sanitize, restore, notify failure; on success mark native frame and request recapture (`148-166`).
- `handoff-ready` → prepare equality proof; seamless disposes without redraw then returns ownership; mismatch synchronously recovers (`168-178`).
- `native-commit` → validate/prime handoff and invoke saved native render plus commit callback. Rejection recovers; failure disables/restores, reports returned, then throws; success clears renderer and marks native frame (`179-192`).
- `native-fallback` and terminal-write-failure outcomes synchronously recover (`193-197`).

PARTIAL reasons: callback exceptions are not independently normalized; width/native physical success relies on saved official renderer; geometry currency for `prepareNativeHandoff` is supplied by the managed-renderer outcome contract rather than checked here.

### 5.9 `beginRuntimePatch` (`202-213`) — PROVEN

Preflight rejection returns `undefined` after invoking rejection callback. Acceptance synchronously constructs and returns the installed patch. Preflight or constructor callback/property exceptions propagate after constructor rollback where applicable.

## 6. Contracts and preflight

### `runtime-patch-contract.ts` (`7-29`) — PROVEN static contract

The interface exposes snapshot leasing, immutable internals/layout references, activation/drain/release/recovery/gate operations, activity, and observer lookup. No runtime branch exists. Limitation: the type does not encode phase-specific legality (for example, `returnToNativeFromGate` versus active recovery), ownership state, or single-release obligations.

### `probeRuntimePatchTarget` (`runtime-patch-preflight.ts:11-25`) — PROVEN

Sequential rejection postconditions:

1. ABI unavailable → reject ABI reason.
2. terminal unsupported → reject allowlist reason.
3. non-extensible or existing marker → reject existing runtime owner.
4. own renderer/stop method → reject extension lifecycle owner.
5. layout mismatch → reject nine-child reason.
6. visible overlay → reject overlay reason.
7. otherwise return exact validated internals/layout.

Reject-callback exceptions propagate instead of returning `undefined`. Hidden overlays are accepted because `hasOverlay()` is false for them, as covered by tests.

### `runtime-phase.ts` (`1-9`) — PROVEN declaration, DISPROVEN lifecycle closure

The union exactly includes all phases assigned by the coordinator. It does not enforce transitions, and source admits the unsafe edges in §3.

## 7. Entry and width recapture

### `enterManaged` (`managed-entry.ts:18-38`) — PROVEN

PRE: live installed patch; input registration and tool accessor callable; `isCurrent` accurately reflects coordinator ownership.

1. Query DSR with 150 ms timeout and replay non-report input to Pi.
2. First stale check returns `cancelled` before baseline/renderer construction.
3. Capture native entry baseline; initialize fresh ledger with baseline-committed components.
4. Construct renderer.
5. Second stale check returns `cancelled` before activation.
6. Activate and return `activated`.
7. Catch maps every error to `failed(error)` only if still current, otherwise `cancelled`.

Caller establishes the currentness predicate with generation and controller identity. Untraced external exceptions are contained by the catch.

### `beginWidthRecapture` (`begin-width-recapture.ts:14-28`) — PARTIAL

PRE: caller-supplied `isCurrent(abort)` is stable and callbacks do not throw.

Creates and returns one abort controller, starts width reentry, ignores stale/cancelled completion, calls exactly one activation or failure callback otherwise. There is no terminal `.catch`; a throwing `isCurrent`, `onActivated`, or `onFailed` creates an unhandled rejected promise. Coordinator callbacks are assignment/recovery routines and normally satisfy the PRE, but the function contract itself does not enforce it.

### `reenterManagedAfterWidth` (`width-reentry.ts:17-43`) — PROVEN

DSR query → stale check → require existing reconciler → reconcile current chat → baseline recapture from first managed component → construct renderer → second stale check → activate. Missing observer throws the explicit ledger-unavailable error. Catch maps to `failed` only while current, else cancelled.

Caller verification: width/native commit gate retains the same patch and reconciler; `renderOnce` clears only `renderer`, not `reconciler` (`runtime-patch.ts:148,189-190`). Exact controller identity is supplied by coordinator.

## 8. Native commit and handoff

### `commitNatively` (`native-commit.ts:10-25`) — PROVEN

PRE: current managed state and saved native renderer; handoff’s geometry/current-frame PRE.

- Failed seamless predicate → `rejected(reason)`, no saved native call and no commit callback.
- Predicate true → call saved native render, then callback, then `committed`.
- Either call throwing → `failed(error)`.

The result does not distinguish native-render failure from post-render callback failure; callers conservatively release to fallback for both.

### `equalLines` (`native-handoff.ts:11-13`) — PROVEN

POST true iff lengths and every indexed string are equal.

### `prepareNativeHandoff` (`native-handoff.ts:15-54`) — PARTIAL

PRE: `state.frame.area.{width,terminalHeight}` equals current terminal geometry; state represents current physical managed frame.

Rejections, all before baseline mutation:

1. stable rows unknown or count differs from `area.top` (`18-20`);
2. displaced native entry provenance not exhausted (`21-23`);
3. native render contains terminal image (`24-25`);
4. either cursor absent (`26-28`);
5. normalized native visible tail differs from stable+managed+bottom-padding physical frame (`29-39`);
6. cursor row/column differs (`40-44`).

Success atomically (with respect to synchronous JS execution) primes `previousLines`, width, height, viewport top, cursor row, hardware cursor, max-lines high-water mark, and Kitty image IDs, then returns seamless (`46-54`).

PARTIAL: current terminal columns/rows are not locally compared with frame dimensions. The managed-renderer outcome is expected to establish this PRE, but that implementation is outside this requested lifecycle file set. Calls to component render/cursor extraction/normalization/Kitty collection may throw and propagate before or during the final assignment block; the latter assignments themselves are ordinary field writes except Kitty collection, which is evaluated at the last assignment.

## 9. Native entry baseline

### `firstMismatch` (`native-entry-baseline.ts:17-23`) — PROVEN

Returns the least differing index within the shared prefix, or the shorter length when no shared-prefix mismatch exists.

### `captureNativeEntryBaseline` (`25-91`) — PROVEN with explicit external exceptions

PRE: Pi baseline corresponds to the latest successful official render; DSR cursor is current; layout is the probed layout.

- `31-35`: geometry mismatch or empty baseline throws the explicit geometry error.
- `36-39`: non-integer/out-of-terminal physical origin throws the explicit origin error.
- `40-52`: render native prefix and derive stable end; optional first-managed component can only move stable end earlier.
- `53-64`: clamp natural top/bottom, reconstruct visible rows, and conservatively attest stable rows.
- `65-75`: create area/frame and include cursor only when inside the managed area.
- `77-83`: mark only whole chat components ending at/before stable end as baseline committed.
- `84-90`: return complete baseline object.

Every render/normalize/area/frame exception propagates to `enterManaged`/width reentry, which maps it to failure or cancellation. The function mutates no TUI ownership or phase.

## 10. Native recovery and method restoration

### `recoverNativeRenderer` (`recover-native-renderer.ts:4-19`) — PROVEN

- Stopped TUI returns `undefined` without writes or redraw.
- Otherwise sanitation write is attempted and its error retained.
- Native baseline is invalidated even if sanitation failed.
- Saved native renderer is attempted; its error is retained only if no earlier sanitation error.
- Returns first error or `undefined`.

### `restoreRuntimePatchMethods` (`restore-runtime-patch-methods.ts:5-14`) — PARTIAL

Identity checks prevent deleting foreign replacements. Under PRE “matching patch properties are configurable,” POST removes all matching patch properties. Without that PRE, ignored `Reflect.deleteProperty(false)` disproves unconditional restoration.

### `invalidateNativeBaseline` (`invalidate-native-baseline.ts:3-9`) — PROVEN

POST: lines empty, width/height `-1`, viewport top `0`, Kitty image IDs empty. The next official render observes dimension-change/full-render conditions. Cursor/high-water fields are not reset here, but official full render overwrites them.

## 11. Caller-precondition verification

| Callee PRE | Caller evidence | Verdict |
|---|---|---|
| patch installation has validated ABI/layout/no owner | `beginRuntimePatch` calls preflight immediately before synchronous construction (`runtime-patch.ts:202-213`) | PROVEN |
| managed entry patch remains current | coordinator closure checks generation/controller; entry checks twice (`runtime-coordinator.ts:55-101`; `managed-entry.ts:18-38`) | PROVEN |
| width reentry retains same ledger | width/native branches clear renderer only; observer returns reconciler (`runtime-patch.ts:88-90,148,189-190`) | PROVEN |
| recapture callback belongs to exact patch/generation/gate/controller | coordinator comparisons at `169-188` | PROVEN |
| returned callback cannot clear a newer patch | generation and identity guard (`206-214`) | PROVEN |
| native handoff geometry is current | supplied indirectly by managed-renderer outcome, not checked in requested caller/callee pair | PARTIAL |
| `startRun` called only from idle or already-entering | no local caller proof inspected; method mishandles other legal union states | DISPROVEN as total API |
| `finishRun` called exactly once and never after disposal | no local enforcement; repeated calls violate ownership/phase | DISPROVEN as total API |
| matching wrapper properties remain configurable until release | constructor establishes; external code can change descriptors | PARTIAL environmental assumption |
| recapture completion callbacks do not throw | coordinator activation callback is assignments; failure path performs guarded gate return | PROVEN for normal coordinator callbacks; PARTIAL generic API |

## 12. Official Pi source evidence

The lifecycle patch targets real Pi renderer state rather than guessed fields:

- Official `TUI` declares `previousLines`, `previousKittyImageIds`, `previousWidth`, `previousHeight`, `hardwareCursorRow`, `maxLinesRendered`, `previousViewportTop`, render scheduling, and `stopped` (`packages/tui/src/tui.ts:295-317`).
- Official `stop()` sets `stopped`, clears its timer, positions relative to `previousLines`/`hardwareCursorRow`, shows the cursor, and stops the terminal (`packages/tui/src/tui.ts:687-711`). This supports patching `stop` so recovery precedes native shutdown.
- Official `requestRender(true)` invalidates lines/dimensions/cursor state and schedules `doRender` unless stopped (`packages/tui/src/tui.ts:714-740`).
- Official `doRender()` detects width/height changes (`packages/tui/src/tui.ts:1256-1262`). Width change forces a full render, supporting the saved-native-render width gate.
- Official full render writes terminal output and then commits native baseline/cursor/image fields (`packages/tui/src/tui.ts:1285-1326`).
- Official no-change, deletion, full-redraw, and differential paths update viewport, dimensions, lines, image IDs, and cursor state (`packages/tui/src/tui.ts:1398-1460,1603-1621`).
- Official terminal writes and the explicit over-width crash path can throw; lifecycle recovery therefore must preserve exceptional exits rather than assume native rendering is total (`packages/tui/src/tui.ts:1256-1621`).

This evidence validates `TuiInternals`’ field model and `invalidateNativeBaseline`’s `-1` dimension trigger. It does not validate unsafe coordinator event ordering.

## 13. Test/spec coverage and untraced paths

Inspected tests:

- `runtime-coordinator.test.ts`: normal entry/render/handoff, delayed entry cancellation by finish/shutdown, recovery failure fallback, installation getter failure, capture while active, hidden overlay.
- `runtime-patch.test.ts`: zero-write gate, patched stop recovery, partial constructor rollback, existing owner, layout rejection.
- `managed-runtime.test.ts`: native commit failure, stop/shutdown recovery, width recapture, image/overlay fallback, terminal-write failure.
- `demand-driven-runtime.test.ts`: native commit followed by DSR reentry.
- `native-handoff.test.ts`: one seamless prime and displaced-entry rejection.
- `native-tui-snapshot.test.ts`: idle native snapshot ownership and capture failure restoration.
- `runtime-event-isolation.test.ts`: lifecycle observation without message mutation or abort.

Untraced or untested paths:

1. duplicate `startRun` while active/gated/draining;
2. duplicate `finishRun` while draining;
3. `finishRun` after `shutdown`;
4. every preflight rejection in one table (unsupported terminal, non-extensible TUI, marker owner, own stop alone, visible overlay);
5. capture restoration exception suppression and resulting terminal state;
6. `beginDrain` synchronous exception;
7. gate catch-up native-render exception;
8. callback exceptions for width redraw, native commit, returned, recapture activation/failure;
9. `Reflect.deleteProperty(false)` after descriptor mutation;
10. handoff rejections for unknown stable rows, images, absent cursor, visible-frame mismatch, cursor mismatch;
11. live terminal geometry differing from handoff frame geometry;
12. native entry geometry/origin exceptions and absent first-managed component;
13. query timeout, abort, late DSR filter, and DSR write exception as integrated lifecycle traces;
14. stopped recovery early return;
15. sanitation and native redraw both throwing, including first-error precedence;
16. snapshot callback exceptions and snapshot/recovery concurrency;
17. external component render, cursor extraction, normalization, and Kitty-ID collection exceptions.

## 14. Per-function verdict index

| File / function | Verdict |
|---|---|
| `runtime-coordinator.ts` fields | PROVEN |
| `capture` | PARTIAL |
| `startRun` | DISPROVEN |
| `currentPhase`, `noteEvent` | PROVEN |
| assistant/tool event methods | PROVEN modulo callback exceptions |
| `snapshot` | PARTIAL |
| `finishRun` | DISPROVEN |
| `shutdown` | PROVEN |
| width/native commit wrapper methods | PROVEN |
| `beginRecapture` | PROVEN under callback PRE |
| `failRecapture` | PARTIAL |
| `handleWidthRedrawFailure`, `cancelCurrentEntry`, `handleReturned` | PROVEN |
| `enterFallback` | PROVEN locally; unsafe as used |
| `isManaged`, `observer` | PROVEN |
| `InstalledRuntimePatch.constructor` | PROVEN under descriptor PRE |
| `activate` | PROVEN |
| `beginDrain` | PARTIAL |
| `dispose` | PARTIAL |
| `recoverSynchronously` | PROVEN |
| `returnToNativeFromGate` | PARTIAL |
| `isActive`, `observer` | PROVEN |
| `beginSnapshot` | PARTIAL |
| patched `stop` | PROVEN |
| `render` | PROVEN with callback qualification |
| `renderOnce` | PARTIAL |
| `beginRuntimePatch` | PROVEN |
| runtime patch contract interfaces | PROVEN static contract |
| `probeRuntimePatchTarget` | PROVEN |
| `RuntimePhase` declaration | PROVEN; transition closure DISPROVEN |
| `enterManaged` | PROVEN |
| `beginWidthRecapture` | PARTIAL |
| `reenterManagedAfterWidth` | PROVEN |
| `commitNatively` | PROVEN |
| `equalLines` | PROVEN |
| `prepareNativeHandoff` | PARTIAL |
| `firstMismatch` | PROVEN |
| `captureNativeEntryBaseline` | PROVEN |
| `recoverNativeRenderer` | PROVEN |
| `restoreRuntimePatchMethods` | PARTIAL |
| `invalidateNativeBaseline` | PROVEN |

## 15. Optimization

1. Make lifecycle operations total and idempotent. `startRun()` should no-op or explicitly recover/detach when a patch already exists; it must never change to a native phase while leaving `PatchActive(P)`. `finishRun()` should no-op in `draining-handoff` and `disposed`.
2. Make `disposed` absorbing for every method except an explicitly named new-session reset/capture operation. If coordinator reuse across sessions is intended, encode that as a deliberate `disposed → idle/fallback` capture edge rather than allowing `finishRun` to resurrect it.
3. Centralize a checked transition invariant: before entering `idle-native`, `active-native-fallback`, or `disposed`, require `this.patch === undefined` or perform the correct release. Before entering managed/gate/drain phases, require a matching installed patch.
4. Check `Reflect.deleteProperty` results. If a matching patch wrapper cannot be deleted, return/throw a restoration failure and keep the owner marker consistent rather than silently claiming release.
5. Do not silently swallow prior restoration failure in `capture`; at minimum notify and force fallback, preserving the exception as diagnostic evidence.
6. Add a direct terminal-geometry equality check in `prepareNativeHandoff`, or encode and assert the managed-renderer geometry postcondition at the call site.
7. Terminate `beginWidthRecapture`’s promise chain with a catch that routes unexpected predicate/callback failures through the same fallback exactly once.
8. Add focused regression tests for the two blocker traces before accepting the lifecycle proof.
9. Update the design phase list to include `native-commit-gate` and document whether `disposed` is terminal and whether lifecycle event handlers are required to be exactly-once.

## Conclusion

Normal single-run operation is substantially proved: ownership installation is synchronous, stale async activation is guarded, recovery releases methods before native redraw, and official Pi state supports the baseline/reflow assumptions. The overall lifecycle is nevertheless **DISPROVEN** because coordinator phase assignments are not ownership-preserving under duplicate/out-of-order `startRun` and `finishRun`, and because `finishRun` breaks disposal finality. These are source-level counterexamples not covered by the inspected tests.