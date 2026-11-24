# Round 005 Bundle A — Disprove-first review

## Review

- Note: `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` does not exist. The requested `/Users/ssyram/workspace/ai-tools/pi-mono/progress.md` contains only `Status: In Progress` with empty task/file/note sections. No `docs/audit` content was read.

### F01 — Geometry specification/code contradiction

**Verdict: UPHELD**

**Disproval angles attempted**

- Treated “upward growth” as possibly meaning only a logical crop-window shift. That interpretation does not fit the design’s explicit description of moving rows through a top scroll region.
- Checked whether downward capacity is consumed first and a separate caller subsequently invokes top expansion. The only active growth plan returns an expansion with identical old/new top coordinates.
- Checked resize rebasing as an alternate implementation of overflow growth. `rebaseManagedHeight` only fits mandatory rows after a terminal-height change; it does not implement live overflow expansion.

**Exact source evidence**

- `my-plugins/codex-viewport/docs/design/detailed-design.md:15` describes `live-region-growth.ts` as “downward-first, upward-on-overflow.” Lines 71–76 say remaining overflow crops the pending transcript but also say upward rows are displaced one row at a time through a top scroll region.
- `my-plugins/codex-viewport/docs/design/architecture.md:82` and `:127` instead say terminal-bottom overflow only crops the pending transcript and never scrolls stable rows or inserts history. The README’s runtime model makes the same downward-then-crop promise.
- `my-plugins/codex-viewport/live-region-growth.ts:10-16` computes only `downwardGrowth`, preserves `area.top`, and calls `buildViewportExpansion(area.top, area.top)`.
- `my-plugins/codex-viewport/viewport-expansion.ts:6-18` can generate top-scroll-region bytes only when `nextTop < currentTop`; equal coordinates return empty bytes and zero displaced rows. Therefore its production call from `planLiveRegionGrowth` is dead as an upward-expansion mechanism.
- `my-plugins/codex-viewport/managed-height-rebase.ts:3-9` can reduce `top` only while rebasing to a changed terminal height and mandatory-row count. It is not called as the remainder step of live-region overflow planning.

**Reachability**

- The contradiction is reached whenever pending content needs more rows after `area.bottom` reaches `terminalHeight`, which is an ordinary long-stream/long-editor case. The running behavior is the README/architecture behavior: no upward expansion occurs and excess pending content is cropped. The contradictory upward-growth design text and expansion implementation are not merely hypothetical; the expansion code is present but receives a no-op plan.

**Concrete test/PoC**

```ts
const area = createInlineViewportArea(80, 24, 6, 24);
const growth = planLiveRegionGrowth(area, 5);
assert.equal(growth.area.top, 6);
assert.equal(growth.area.bottom, 24);
assert.equal(growth.expansion.displacedStableRows, 0);
assert.equal(growth.expansion.bytes, "");
```

A test implementing the design’s stated upward remainder (`top === 1` and five displaced rows) fails. A second case with `bottom = 20` and overflow `8` demonstrates downward-first behavior: bottom grows by four, while the remaining four rows still produce no top expansion.

### F02 — Entry/handoff omit origin and force the logical tail

**Verdict: WEAKENED**

**Disproval angles attempted**

- Checked the entry transform for the alleged missing physical origin. The current implementation explicitly derives and applies it.
- Checked whether `previousViewportTop` is ignored. It participates in origin derivation, area bounds, visible-row mapping, and stable-row attestation.
- Checked whether handoff blindly installs a tail-derived baseline. It does derive a canonical tail viewport, but refuses installation unless full visible bytes and cursor coordinates agree.
- Checked whether nonzero origin/bottom slack can still prevent seamless handoff. It can: the handoff representation has no explicit origin, and conservative attestation/comparison may reject such a frame. That preserves safety but weakens handoff liveness.

**Exact source evidence**

- `my-plugins/codex-viewport/native-entry-baseline.ts:36-38` computes `originRow = cursor.row - (tui.hardwareCursorRow - tui.previousViewportTop)` and rejects an invalid physical origin.
- `my-plugins/codex-viewport/native-entry-baseline.ts:53-60` uses both `originRow` and `previousViewportTop` in `naturalTop`, `naturalBottom`, and every physical-to-logical visible-row lookup. Lines 62–64 conservatively attest stable rows using the available logical prefix.
- This matches `my-plugins/codex-viewport/docs/design/proofs/hoare-entry-baseline.md:8,16`, whose proof defines `O = actualCursor.row - (hardwareCursorRow - previousViewportTop)` and maps `O + S - previousViewportTop` to the physical top.
- Official Pi retains slack-aware state in `packages/tui/src/tui.ts`, `TUI.doRender`: logical movement is translated through `previousViewportTop`, and `previousBufferLength` is based on `previousViewportTop + previousHeight`, not solely on the current logical tail.
- `my-plugins/codex-viewport/native-handoff.ts:29-40` does compute `viewportTop = max(0, nativeLines.length - height)`, but compares the complete padded native view with the managed physical view before proceeding. Lines 40–43 separately compare physical cursor row and column.
- `my-plugins/codex-viewport/native-handoff.ts:46-53` installs `previousViewportTop`, `hardwareCursorRow`, and the remaining native baseline only after those checks. Lines 18–22 reject unattested stable rows and entry rows that may still be visible.

**Reachability**

- Entry is not subject to the alleged omission in current code, so the compound claim is obsolete there.
- Handoff still normalizes from the logical tail rather than carrying `originRow`. A nonzero-origin or slack-bearing screen can therefore fail stable-row attestation or exact-frame equality and take native recovery instead of seamless handoff. This is a reachable availability/flicker risk, not evidence that mismatched coordinates are committed.
- Existing `inline-entry.test.ts` and `native-handoff.test.ts` cover origin/slack-sensitive entry and rejection predicates, but the useful missing regression is an end-to-end nonzero-origin entry followed by otherwise unchanged handoff, asserting whether seamless handoff is intended or conservative rejection is accepted.

### F03 — Repeated render and opaque/structural finality can commit wrong output

**Verdict: UPHELD**

**Disproval angles attempted**

- Checked whether a transaction renders each component once and reuses immutable bytes. It does not.
- Checked whether prepared bytes are compared with the later managed-frame bytes before terminal write/ledger acceptance. No such comparison exists.
- Checked whether committed-snapshot mutation detection closes the gap. It detects a mismatch only on a later render; it cannot make the already accepted transaction atomic.
- Accounted for JS single-threading. External async mutation cannot interleave inside the synchronous render stack, but `Component.render(width)` itself can be stateful, and no inspected component contract establishes purity.
- Checked whether unknown components remain pending until an explicit completion event. Opaque items are finalized structurally when they cease to be the chat tail.

**Exact source evidence**

- `my-plugins/codex-viewport/managed-renderer.ts:133-160` renders components during commit preparation and records normalized snapshots; committed-snapshot checking invokes `render` independently again and falls back only after observing a mismatch.
- `my-plugins/codex-viewport/managed-render-content.ts:11-21` renders all live item components again, followed by editor/footer/surrounding components. This is the render used to construct the managed frame written in the same transaction.
- `my-plugins/codex-viewport/transcript-ledger.ts`, `TranscriptLedger.prepareCommit`, stores the first rendered `lines`, item IDs, range, and ledger revision. `commitPrepared` validates ledger identity/revision/range, not equality with a subsequent render.
- `my-plugins/codex-viewport/managed-renderer.ts`, `ManagedRenderer.render`, orders the operations as prepare commit, render managed content, plan/write the frame, then accept the prepared commit. There is no comparison between the preparation snapshot and the later live render before acceptance.
- `my-plugins/codex-viewport/component-ledger-reconciler.ts:86-89` finalizes every pending opaque item whose first component is no longer `chat.children.at(-1)`. No completion event or byte-stability predicate is involved.
- `my-plugins/codex-viewport/docs/design/detail/transcript-ledger.md:38-42,78` says opaque content without a completion contract remains pending and that equal renders are not finality evidence. Lines 91–96 require immutable prepared lines before terminal write and commit. The structural non-tail rule is weaker than that stated policy.

**Reachability**

- All repeated calls are on the production managed-render path. A valid third-party/unknown Pi component can have cache advancement, lazy formatting, or another observable render side effect because purity is not enforced by the `Component` interface.
- Opaque structural finality is reached whenever an unknown pending chat child is followed by another child. If that earlier component can still invalidate or change, it is eligible for commit without an explicit completion contract.
- Later `assertCommittedSnapshots` and native recovery limit persistence after another render request, but they do not prevent the current write from using one result while stable/committed bookkeeping accepts another.

**Concrete test/PoC**

Create an opaque component whose `render()` returns `A` on its first call and `B` on its second, append a second chat child so the first item is no longer the tail, and execute one `ManagedRenderer.render()` transaction. Assert all of the following:

1. `render()` was invoked at least twice in that transaction.
2. The prepared snapshot/stable preview contains `A`.
3. The terminal frame contains `B`.
4. The ledger nevertheless marks the opaque item committed after the write.
5. A following render either detects mutation and falls back or diffs from the wrong accepted baseline.

That test isolates the issue without an async race; the render method’s own state transition is sufficient.

### F04 — Duplicate/out-of-order lifecycle calls corrupt patch ownership or resurrect disposal

**Verdict: WEAKENED**

**Disproval angles attempted**

- Exercised duplicate calls in every coordinator phase. Duplicate entry while `entering-managed` is ignored, and stale async entry completion is generation/phase/patch guarded.
- Checked active-managed and draining phases. Duplicate/reordered calls can produce phase/patch ownership inconsistencies at the coordinator API level.
- Checked shutdown resurrection. A later `startRun()` changes the phase label away from `disposed`, but shutdown has cleared all prerequisites and disposed/restored the patch, so it cannot reactivate that disposed patch.
- Traced every production caller through the plugin wiring, `AgentSession`, and the official low-level agent loop rather than assuming exactly-once delivery. The normal deployed path emits and awaits one start followed by one terminal end; no normal duplicate/reversed caller was found.
- Checked exceptional synthetic `agent_end` sites in `agent.ts`/the harness. They provide terminal settlement for failure paths; the inspected evidence does not establish a deployed path that emits a second end after an already completed normal end.

**Exact source evidence**

- `my-plugins/codex-viewport/codex-viewport.ts:49-78` is the complete production wiring: `agent_start` calls `runtime.startRun()`, `agent_end` calls `runtime.finishRun()`, and `session_shutdown` calls `runtime.shutdown()`. There is no plugin-side deduplication.
- `my-plugins/codex-viewport/runtime-coordinator.ts:49-52` ignores `startRun()` only in `entering-managed`. In another non-idle phase it enters native fallback. Thus a duplicate start in `active-managed` changes the phase while retaining the installed patch.
- `my-plugins/codex-viewport/runtime-coordinator.ts:118-151` sends the first managed finish to draining, but a subsequent finish falls through to `idle-native` without necessarily clearing the patch. Entry cancellation increments a generation and checks generation, phase, and patch identity, preventing delayed entry resurrection.
- `my-plugins/codex-viewport/runtime-patch.ts:51-59` rejects activation after disposal. Lines 170–176 dispose/restore the patch before reporting a completed seamless return.
- `my-plugins/codex-viewport/restore-runtime-patch-methods.ts:8-13` removes owned methods only when their current values still equal the patch-owned values, preventing stale disposal from deleting another owner’s methods.
- `packages/agent/src/agent-loop.ts:108-115,137-140` emits one awaited `agent_start` for each low-level run entry. Error/abort, graceful-stop, and normal completion emit `agent_end` at lines 195–198, 246–255, and 269–273 respectively, and terminal branches return. `packages/agent/src/types.ts:418-425` specifies `agent_end` as the last event of a run and includes listener settlement in run completion.
- `packages/coding-agent/src/core/agent-session.ts:695-700` maps each received lifecycle event to exactly one awaited extension-runner emission. Extension dispatch finishes before ordinary session listeners (`agent-session.ts:601-605`).
- `packages/coding-agent/src/core/agent-session-runtime.ts:167-172,395-400` awaits `session_shutdown` before session invalidation/disposal callbacks, reducing the opportunity for a late lifecycle event after plugin shutdown.

**Reachability**

- Method-level reproduction is straightforward: start to `active-managed`, call `startRun()` again, and observe a native-fallback phase while the TUI still owns a patched `doRender`; or call `finishRun()` twice and observe `idle-native` while the drain patch remains referenced/installed.
- That reproduction requires direct coordinator calls or duplicated extension events. The official normal agent loop and forwarding path serialize a single start/end pair, so the review did not establish ordinary deployment reachability for those duplicate sequences.
- `startRun()` after shutdown does alter `disposed` to `active-native-fallback`, which is an undesirable non-monotonic phase transition, but it cannot resurrect managed rendering: `shutdown()` clears the TUI, input registration, context, and patch, while `InstalledRuntimePatch.activate()` rejects a disposed patch.
- A focused coordinator regression should still assert that all calls in `disposed` are no-ops and that duplicate start/finish calls either remain in the current phase or synchronously recover/dispose the patch. This hardens the boundary against future caller changes even though today’s normal official caller mitigates it.
