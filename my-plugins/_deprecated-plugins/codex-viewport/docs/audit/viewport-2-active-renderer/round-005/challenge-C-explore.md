<results>
<files>
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/query-terminal-cursor.ts -- DSR registration, timeout, late filtering, and replay.
- /Users/ssyram/workspace/ai-tools/pi-mono/packages/tui/src/tui.ts -- Pi listener ordering and `{ consume: true }` semantics.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/terminal-app-capture.ts -- `osascript` capture without timeout.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/resolve-controlling-tty.ts -- `ps` capture without timeout.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/snapshot-lease.ts -- blocked-write accumulation and replay.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/inline-viewport-frame.ts -- incomplete cursor-column bounds.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/screen-frame-diff.ts -- shrinking-area stale-row defect.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.ts -- full-height/bottom-padding attestation.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-renderer.ts -- logical commit after `Terminal.write`.
- /Users/ssyram/workspace/ai-tools/pi-mono/packages/tui/src/terminal.ts -- synchronous `process.stdout.write` boundary.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/query-terminal-cursor.test.ts -- DSR coverage and missing competition cases.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/resize-epoch.test.ts -- partial native-write failure coverage.
</files>

<answer>
**F09 — DSR input ownership/exactly-once: DISPROVEN, scope-reduced.**

`queryTerminalCursor` installs an independent listener, consumes DSR-like prefixes, retains a late filter for up to 1000 ms, and replays buffered input after timeout/abort. Pi’s `/Users/ssyram/workspace/ai-tools/pi-mono/packages/tui/src/tui.ts:763-780` processes listeners in insertion order; `{ consume: true }` prevents later listeners and focused-component delivery. There is no exclusive ownership or query multiplexer.

Deterministic counterexample: query A times out, query B starts during A’s late-filter window, and one CPR arrives. A may consume the CPR before B; buffered escape input may also be replayed through the normal input path, causing duplication or delay. Existing tests cover adjacent input, split CPR, explicit abort replay, late complete CPR, and write failure, but not competing registrations or natural-timeout incomplete-prefix replay.

The “synchronous registration” subclaim is not demonstrated against Pi’s actual `addInputListener` implementation, which returns its unregister closure synchronously. The listener-competition/late-filter exactly-once claim remains disproven.

Required regression test: install two real listeners, issue overlapping cursor queries, inject one CPR plus adjacent user input, and assert exactly one query resolves while user input is delivered once.

**F10 — unbounded child capture freezing snapshot/TUI: UPHELD with wording reduction.**

Capture duration is unbounded: both `resolveControllingTty` (`ps`) and `captureTerminalApp` (`osascript`) call `execFile` without `timeout`, `AbortSignal`, or kill policy. `MAX_CAPTURE_BYTES` limits `osascript` stdout to 64 MiB, so “unbounded output” is too broad; however, `snapshot-lease.ts:28-51` accumulates blocked writes without a bound while the capture promise remains pending.

A hanging `ps`/`osascript` leaves the snapshot lease active, render requests coalesced, terminal writes intercepted, and `blockedOutput` growing. Existing snapshot tests inject ordinary capture failures and verify cleanup, but do not test a hung child.

Required regression test: replace `ps` or `osascript` with a child that never exits, begin a snapshot, race completion against a short deadline, and assert timeout, child termination, lease release, and bounded blocked output.

**F11 — incomplete bounds/diff/blank attestation: UPHELD for managed rendering; native-attestation portion rejected.**

`createInlineViewportFrame` rejects invalid rows and negative cursor coordinates but accepts `cursor.column === area.width`; the cursor is then outside the valid horizontal range.

`diffInlineViewport` checks only width equality and compares rows by absolute row. It does not erase rows present only in the previous frame. Example: previous area `[top=1,bottom=4]` with rows `A,B,C`; next area `[top=2,bottom=4]` with rows `B,C`. The generated diff is empty, leaving stale `A` on physical row 1. This path is conditional on a reachable area shrink/shift, but the helper contract permits it and existing tests do not cover it.

The native handoff path is stronger: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.ts:18-53` compares the complete visible frame through terminal height, including bottom padding, and compares cursor coordinates. Thus the “short-bottom native handoff attestation” subclaim is not upheld. It does not repair stale rows created by ordinary managed diffs.

Required regression tests: reject cursor column `width`; require erasure of previous-only rows on area shrink; separately retain the existing full-height native-handoff equality test.

**F12 — partial-write recovery/native-equivalence guarantee: UPHELD only as an explicit physical boundary.**

Pi’s `/Users/ssyram/workspace/ai-tools/pi-mono/packages/tui/src/terminal.ts:454-458` delegates directly to `process.stdout.write(data)` and exposes no byte-count or atomicity acknowledgment. `ManagedRenderer` accepts logical state only after `terminal.write` returns; on throw it cancels logical preparation, but cannot know which bytes reached the terminal.

The test harness has reachable prefix-then-throw seams, and `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/resize-epoch.test.ts` explicitly verifies that a partial native width redraw is not synchronously retried. Snapshot replay likewise writes blocked chunks sequentially; if chunk `k` partially writes and throws, earlier chunks remain delivered, chunk `k` is unknown, and later chunks are skipped. No rollback can restore scrollback or terminal state.

Therefore logical rollback/fail-open behavior is real, but any unqualified physical rollback, exactly-once replay, or native-equivalence promise is unprovable. This is a documented residual boundary rather than a contradiction if the contract explicitly excludes partial physical writes.

Required regression test: fake `Terminal.write` to emit a prefix then throw; assert logical state is canceled, no blind resend occurs, recovery runs, and the resulting physical-prefix uncertainty is surfaced as residual state.
</answer>

<next_steps>
Use the scope-reduced verdicts: fix or serialize DSR ownership, add child-process timeout/abort, clear relinquished diff rows and validate cursor columns, and keep F12 explicitly bounded at the partial-write boundary.
</next_steps>
</results>