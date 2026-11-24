<results>
<files>
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/live-region-growth.ts -- Implements the downward-only growth path relevant to F01.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-entry-baseline.ts -- Explicitly computes `originRow` and maps through `previousViewportTop` for F02.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.ts -- Validates visible rows, cursor, displacement, and native viewport state.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-renderer.ts -- Shows render/prepare/write/accept ordering for F03.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/transcript-ledger.ts -- Enforces finalized-prefix, identity, revision, and prepared-commit invariants.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.ts -- Implements lifecycle generation, phase, patch identity, and disposal guards for F04.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/inline-entry.test.ts -- Covers downward growth but omits terminal-bottom upward overflow.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-runtime.test.ts -- Covers stale-byte replacement, finalization, reentrancy, and fallback.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.test.ts -- Covers delayed finish/shutdown and normal lifecycle recovery.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/architecture.md -- Normative current geometry, finality, transaction, and lifecycle contract.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/detail/frame-layout.md -- Specifies `[top,bottom)` growth semantics.
- /Users/ssyram/workspace/ai-tools/pi-mono/packages/tui/src/tui.ts -- Official Pi viewport-top/bottom and scroll behavior.
- /Users/ssyram/workspace/ai-tools/pi-mono/packages/agent/src/agent.ts -- Official Pi completion cleanup caller.
</files>

<answer>
Independent disprove-first results:

**F01 — UPHELD**

Claim: the upward-growth specification contradicts executable crop/downward-only behavior.

Disproval attempt: searched the geometry planner, expansion builder, managed renderer caller, and inline-entry tests for a reachable path that lowers `top` after `bottom === terminalHeight`.

Evidence:
- The current specification requires downward growth first, then upward growth after terminal bottom, with each new row filled by real content: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/architecture.md:32-58` and `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/detail/frame-layout.md:17-23`.
- `planLiveRegionGrowth()` computes only `downwardGrowth = min(overflowRows, terminalHeight - area.bottom)` and never decreases `area.top`: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/live-region-growth.ts:9-17`.
- It always calls `buildViewportExpansion(area.top, area.top)`, making expansion a no-op: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/live-region-growth.ts:14` and `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/viewport-expansion.ts:5-15`.
- The managed renderer reaches this planner: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-renderer.ts:95-98`.
- With `area={top:3,bottom:10,terminalHeight:10}` and `overflowRows=2`, the planner returns unchanged `[3,10)` and no expansion, despite two rows of contractual upward growth being required.
- Existing coverage only tests downward growth to terminal bottom and expects empty expansion: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/inline-entry.test.ts:16-25`.

Reachability: direct and reachable whenever managed content exceeds remaining terminal space after `bottom` reaches terminal height. The overflow is therefore cropped or otherwise omitted rather than represented by upward expansion.

Pinning test: add a terminal-bottom overflow case through `planLiveRegionGrowth()` or `ManagedRenderer.render()` asserting `top` decreases by the residual overflow, `bottom` remains terminal height, `displacedStableRows` equals that residual, expansion bytes are non-empty, and the new rows contain the overflowing content.

**F02 — WEAKENED**

Claim: entry/handoff coordinates omit `originRow` and force a logical tail despite Pi’s `previousViewportTop`/`previousViewportBottom` slack.

Disproval attempt: traced native entry baseline calculation, visible-row mapping, handoff comparison, and official Pi viewport calculations.

Evidence against the core claim:
- Entry explicitly computes `originRow` from cursor, hardware cursor, and `previousViewportTop`: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-entry-baseline.ts:36-64`.
- Visible logical rows are mapped through `previousViewportTop + row - originRow`, so the entry path does not omit origin coordinates.
- Handoff computes native `viewportTop = max(0, nativeLines.length - height)`, compares `stableRows + frame.rows` against the native visible region, and stores the resulting `previousViewportTop`: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.ts:15-54`.
- Official Pi independently tracks `previousViewportTop`, derives `prevViewportBottom`, and scrolls when writes exceed that boundary: `/Users/ssyram/workspace/ai-tools/pi-mono/packages/tui/src/tui.ts:1256-1268` and `/Users/ssyram/workspace/ai-tools/pi-mono/packages/tui/src/tui.ts:1467-1479`.

Residual concern:
- `previousViewportBottom` is not directly consumed by `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-entry-baseline.ts`.
- `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/volatile-region.ts:24-45` intentionally uses `takeTail()` for volatile sections, but that is content cropping, not evidence that entry coordinates omit `originRow`.
- No source/test demonstrates an actual wrong coordinate or handoff caused by the claimed slack omission.

Reachability: the stated `originRow` omission is unreachable in the current entry implementation. A separate future bug involving unused bottom slack remains possible but is not established.

Pinning test: construct an entry with nonzero `previousViewportTop`, distinct `hardwareCursorRow` and cursor row, and unused terminal bottom; assert the computed `originRow`, `[top,bottom)` area, and visible logical-row mapping. Then test handoff with displaced rows plus bottom slack and assert exact visible lines, cursor, and stored Pi viewport state.

**F03 — WEAKENED**

Claim: repeated render plus opaque/structural finality can commit wrong bytes or items.

Disproval attempts:
- Reentrant render requests are coalesced rather than recursively committed: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-patch.ts:51-89`; covered by `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-runtime.test.ts:100-107`.
- Finalized multiline content is tested as one native transition with no duplicate CRLF/control output: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-runtime.test.ts:73-85`.
- Revision/item identity validation rejects stale prepared ranges: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/transcript-ledger.ts:97-137` and `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/transcript-ledger.ts:167-173`.
- Committed component snapshots are re-rendered and compared; mutation throws rather than silently accepting changed committed content: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-renderer.ts:157-160`.
- Latest widget replacement is covered by `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-runtime.test.ts:41-50`.

Residual failure surface:
- `component.render()` is invoked during snapshot/prepare, terminal bytes are written, and only then the ledger accepts the prepared range: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-renderer.ts:76-120` and `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-renderer.ts:133-146`.
- A non-deterministic or side-effectful component could produce different results across repeated render observations; no test pins that adversarial contract.
- The transaction proof explicitly does not roll back partial physical terminal bytes after a write failure: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/proofs/hoare-render-transaction.md:3-9`. This is a physical-output limitation, not evidence that the ledger commits the wrong item.
- No source/caller/test demonstrates a concrete wrong opaque or structural item being committed under ordinary synchronous execution.

Reachability: ordinary repeated render and finalized-prefix paths are guarded. Wrong-byte/item behavior requires an adversarial mutable/non-deterministic renderer or partial terminal write; the claim is not established as a normal reachable bug.

Pinning test: use finalized opaque and structural fixtures with deterministic render snapshots, trigger synchronous reentrant renders, and assert one write, exact bytes, one committed prefix, and stable item IDs. Add a mutable renderer fixture that changes output between observations; require rejection or cancellation and assert no mismatched prepared item is committed.

**F04 — REJECTED-RESURRECTION**

Claim: duplicate/out-of-order `startRun()`/`finishRun()` can leave an active patch under native phase or resurrect a disposed runtime.

Disproval attempts:
- `startRun()` suppresses duplicate entry while `entering-managed`, requires the idle-native phase for a new run, increments generation, and validates the current generation/patch before activation: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.ts:49-100`.
- `finishRun()` moves active managed state into `draining-handoff`; pending entry/recapture/native-commit gates cancel the current entry and clear the patch: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.ts:118-151`.
- Cancellation increments generation, aborts entry work, and clears the patch. Returned callbacks require matching generation, phase, and patch identity: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.ts:174-213`.
- Shutdown clears runtime references and sets `disposed`; delayed-entry tests assert `disposed` with `doRender` absent: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.test.ts:39-63`.
- Normal completion is tested to end in idle-native with the patch removed: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.test.ts:12-33`.
- Official Pi completion invokes cleanup from `finally`, and harness operations reject non-idle concurrent work: `/Users/ssyram/workspace/ai-tools/pi-mono/packages/agent/src/agent.ts:486-489`, `/Users/ssyram/workspace/ai-tools/pi-mono/packages/agent/src/agent.ts:511-524`, and `/Users/ssyram/workspace/ai-tools/pi-mono/packages/agent/src/harness/agent-harness.ts:623-669`.

Reachability: the claimed resurrection path is blocked by phase, generation, patch identity, and disposal guards. Repeated `finishRun()` does not recreate a patch; stale callbacks cannot transition a newer/disposed runtime.

Pinning gap: the repository has no explicit test matrix for duplicate `startRun()`, repeated/out-of-order `finishRun()`, or callbacks from an old generation after disposal.

Pinning test: exercise `startRun()` twice during delayed entry, call `finishRun()` twice in each phase, call `startRun()`/`finishRun()` after `shutdown()`, and deliver stale return callbacks from the prior generation. Assert final phases (`idle-native` or `disposed`), absent `doRender`, no active patch, and no native resurrection.
</answer>

<next_steps>
The strongest actionable defect is F01: implement and test residual upward growth after terminal-bottom saturation. F02 and F04 are primarily disproven by existing source guards; F03 needs an adversarial mutable-renderer test if stronger atomicity is required. Complete artifact content is provided for the authoritative target `/Users/ssyram/workspace/ai-tools/pi-mono/.pi-subagents/artifacts/outputs/585cb6e7/my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/challenge-A-explore.md`.
</next_steps>
</results>