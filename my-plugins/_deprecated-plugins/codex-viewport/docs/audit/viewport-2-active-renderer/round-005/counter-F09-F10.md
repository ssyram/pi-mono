# Round 005 counter-challenge — F09/F10

## Review

- Correct: current Pi makes the synchronous-registration leak unreachable. `TUI.addInputListener()` only inserts into the listener `Set` and returns its disposer; it does not invoke the listener during registration (`packages/tui/src/tui.ts:649-654`).
- Correct: focused existing tests passed: `node --test --import tsx my-plugins/codex-viewport/query-terminal-cursor.test.ts my-plugins/codex-viewport/resolve-controlling-tty.test.ts` reported 7 passed, 0 failed.
- Note: the requested root `plan.md` does not exist. The review used the Round 005 plan at `my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/plan.md`; root `progress.md` contains only empty progress headings.

## F09 — CONFIRMED, with the synchronous-registration subclaim REJECTED

### Exact confirmed scope

Current Pi does not provide exclusive DSR ownership or exactly-once observation across its complete input-listener chain:

1. Pi dispatches listeners sequentially in `Set` insertion order. An earlier listener can return `consume` and prevent the cursor-query listener from seeing the DSR, or return replacement `data` and change what it sees (`packages/tui/src/tui.ts:771-785`). Thus the query cannot establish ownership of the original terminal report.
2. Production replay re-enters Pi through `patch.internals.handleInput(data)` (`my-plugins/codex-viewport/managed-entry.ts:21-27`, `my-plugins/codex-viewport/width-reentry.ts:20-26`). When timeout/abort cleanup replays a buffered DSR-like prefix, listeners registered before the query observe those bytes a second time (`my-plugins/codex-viewport/query-terminal-cursor.ts:24-34,58-64`). The exactly-once failure is scoped to replayed buffered data and earlier listeners; it does not imply all ordinary input is duplicated.
3. After timeout or DSR-write failure, the old listener remains installed for 1,000 ms (`my-plugins/codex-viewport/query-terminal-cursor.ts:35-42,75-80`). If a second query is registered during that interval, Pi visits the older listener first. A CPR delivered in that window is matched by the settled old listener, which returns `consume`; Pi then returns without invoking the newer listener (`query-terminal-cursor.ts:47-56`; `packages/tui/src/tui.ts:773-777`). The new query consequently times out despite a valid response having arrived.

This is a deterministic ordering failure, not merely a theoretical concurrency concern. JavaScript is single-threaded here, but the retained listener and the new listener coexist across timer/async boundaries and are ordered by registration.

### Rejected subclaim

The proposed synchronous `registerInput` callback leak is **REJECTED for the current Pi integration**. Although `queryTerminalCursor()` initially uses a no-op disposer until `registerInput()` returns (`query-terminal-cursor.ts:20,43-65`), official Pi registration does not synchronously call the newly registered handler (`packages/tui/src/tui.ts:649-654`). Therefore current production cannot settle inside registration, leak that subscription, or write DSR after such settlement. This rejection is narrowly pinned to the current `TUI.addInputListener` adapter contract; it would need reassessment if a different registration implementation were supplied.

### Pinning test

Add a test backed by a faithful multi-listener dispatcher using an insertion-ordered `Set`, Pi's `consume`/`data` rules, and replay through that same dispatcher:

1. Register observer A before query 1. Make A return `consume` for CPR and assert query 1 times out, proving earlier-listener competition.
2. Let query 1 receive and buffer a partial `"\x1b"`, allow it to time out, and run late cleanup. Assert observer A sees the buffered escape once on initial dispatch and once on replay, while the downstream normal-input sink receives it once.
3. Time out query 1, start query 2 before the 1,000 ms late-cleanup deadline, dispatch exactly one `"\x1b[3;1R"`, and assert query 1's retained filter consumes it while query 2 times out. Also assert both subscriptions are eventually removed.
4. Integration-pin the adapter separately: registering through real `TUI.addInputListener` must not invoke the callback before returning its disposer. This preserves the rejection of the synchronous-registration subclaim.

The desired post-fix acceptance condition for step 3 is that the valid CPR resolves query 2 and no stale query can consume it; unrelated adjacent input must reach normal input exactly once.

## F10 — CONFIRMED

### Exact confirmed scope

There is no code-level upper bound on a snapshot's `ps` or `osascript` wait:

1. `resolveControllingTty()` awaits promisified `execFile("ps", ...)` with only `encoding` configured (`my-plugins/codex-viewport/resolve-controlling-tty.ts:15-17`).
2. `captureTerminalApp()` awaits promisified `execFile("osascript", ...)` with `encoding` and `maxBuffer`, but no `timeout` or `signal` (`my-plugins/codex-viewport/terminal-app-capture.ts:28-33`). `maxBuffer` bounds captured child output; it is not a runtime deadline and does not help a silent stuck child.
3. Node exposes `timeout` with default `0` and optional abort support for `ExecFileOptions` (`node_modules/@types/node/child_process.d.ts:648-656,1053-1059`). The call sites opt into neither mechanism, so Node supplies no finite deadline.
4. The snapshot lease is acquired before physical capture, spans both `capturePhysical()` awaits, and releases only in `finally` after the pending await settles (`my-plugins/codex-viewport/execute-snapshot.ts:21-50`). While held, non-diagnostic terminal writes append to an uncapped `blockedOutput` array and are not emitted until release (`my-plugins/codex-viewport/snapshot-lease.ts:12-25,40-52`).

Accordingly, a child that never exits can retain render/write ownership indefinitely. “Freeze” is scoped to the snapshot-owned render gate and intercepted terminal output, not to JavaScript event-loop execution: callbacks may continue running, but user-visible terminal writes are buffered. “Unbounded output” means no application cap exists on `blockedOutput` while other activity continues to write; it does not claim output grows when no writes occur. If both child processes exit or error, `finally` releases the lease, so the finding is specifically the absent deadline/cancellation path.

### Pinning test

Run the production capture path with temporary `PATH` shims, testing `ps` and `osascript` separately. Each shim must announce its PID/start and then remain silent and pending until the test kills it. While capture is pending:

1. Start a snapshot with a real lease over a fake terminal and save the original `write` function.
2. Wait beyond the required product deadline and assert the snapshot has not settled under current code; assert the write interceptor is still installed and a sentinel terminal write has not reached the physical sink.
3. Generate repeated sentinel writes and assert they accumulate behind the lease. Keep the count finite in the test; the production defect is the missing cap.
4. Kill the shim in test cleanup so the suite cannot leak a child, then assert the snapshot settles and the lease releases.

The failing-then-passing acceptance test for a fix should instead require each child to be terminated and the snapshot to reject within a fixed deadline plus scheduler tolerance, require the lease/write interceptor to be released by that same bound, and verify no child PID remains. Pin both commands independently: a timeout around only `osascript` would leave the `ps` path vulnerable, while a bare `Promise.race` that releases the lease but leaves the child alive would not satisfy child-resource cleanup.

## Final verdict

- **F09: CONFIRMED** for listener competition, earlier-listener replay duplication, and stale late-filter/new-query races. **REJECTED** only for the synchronous-registration leak in current Pi.
- **F10: CONFIRMED** for absent `ps` and `osascript` deadlines/abort, indefinite lease retention, and uncapped blocked terminal writes during that retention.
