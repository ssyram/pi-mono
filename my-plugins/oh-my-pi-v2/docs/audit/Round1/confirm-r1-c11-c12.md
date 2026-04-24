# Confirm R1-C11 / R1-C12

Scope: fresh confirmation using only `round-context.md` plus runtime source needed for reload/countdown behavior.

## R1-C11 — reload failure clears task state before failing

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. `registerTaskTool()` owns in-memory task state in closure variables `tasks` and `nextId`.
2. `reloadState()` begins by assigning `tasks = []` and `nextId = 1`.
3. Only after clearing does it iterate `ctx.sessionManager.getEntries()` and rebuild from the latest `custom: "pi-task-state"` entry.
4. `reloadState()` is registered on `session_start` and `session_tree`.
5. There is no rollback around the clear. If `ctx.sessionManager.getEntries()` or iteration throws after the initial assignments, the exception exits `reloadState()` with the closure state already empty/reset.
6. Later users of the same handle, including `getTaskState()` and `before_agent_start`, read the cleared in-memory state.

Relevant source behavior:

- `tools/task.ts`: `reloadState()` clears `tasks`/`nextId` before reading session entries.
- `tools/task.ts`: `reloadState()` is invoked from `session_start` and `session_tree` hooks.
- `tools/task.ts`: `getTaskState()` returns the current closure state; no disk re-read or recovery happens there.

Deployment/reachability check: this matches the documented deployment model: task state is session-backed through append-only custom session entries, while runtime hook state is in-memory. A session entry read/iteration failure during a reload hook is sufficient to leave the in-memory task state cleared before the reload failure propagates.

## R1-C12 — activeCountdown retains completed handle after natural finish and has runtime impact

**Verdict: CONFIRMED — solid rationale**

Concrete runtime path:

1. `agent_end` starts by canceling any existing `activeCountdown` and setting it to `undefined`.
2. If active work remains, it creates a `fire` callback and assigns `activeCountdown` to the handle returned by `startCountdown(...)` or `startSilentCountdown(...)`.
3. On natural countdown completion, `fire` re-checks current task state and either returns or sends the restart message.
4. The natural-finish path in `fire` does **not** assign `activeCountdown = undefined`.
5. The countdown helpers also do not clear the caller-held variable; they only run their local cleanup / callback behavior.
6. Therefore the module-level `activeCountdown` can retain a completed handle until the next `agent_end`, `session_start`, or `session_tree` path cancels it and clears it.

Runtime impact confirmed, but limited:

- Visible countdown: natural finish runs local cleanup first, setting its closed-over `cancelled` flag. A later stale `activeCountdown.cancel()` is a no-op because `cancel()` checks `!cancelled`.
- Silent countdown: natural finish calls `onFinish()` without setting `cancelled = true`. A later stale `activeCountdown.cancel()` sets the closed-over flag and calls `clearTimeout(timer)` on an already-fired timeout.
- Boulder runtime paths (`agent_end`, `session_start`, `session_tree`) can therefore execute cancellation logic against a completed handle. This is real retained-state behavior, but I did not find evidence of duplicate restart injection or persistent stop/cancel semantics from the retained handle.

Relevant source behavior:

- `hooks/boulder.ts`: module-level `activeCountdown` is assigned the countdown handle and is only cleared in preflight/reset paths, not in the countdown `fire` callback.
- `hooks/boulder.ts`: later `agent_end` and reset paths call `activeCountdown?.cancel()` before clearing it.
- `hooks/boulder-countdown.ts`: natural finish does not clear the caller reference; visible completion makes later cancel a no-op, silent completion leaves a stale handle whose later cancel mutates local state and clears an already-fired timer.
