# Loop 2.0 Integration Plan

## Current status

Loop 2.0 is integrated and is the only implementation. Loop 1.x (`src/scheduler.ts`, `src/job-store.ts`, `src/register-scheduled-wakeup-tool.ts`, `src/parse-loop-command.ts`, `src/format-job.ts`, `src/types.ts`) was deleted together with its v1 tests; no dual-track or compatibility layer remains.

Actual wiring files:

- `src/extension.ts` — session_start builds `LoopV2Core` (session id, branch entries via `getBranch()` + `pi.appendEntry()`, workspace root `ctx.cwd`, global root `os.homedir()`, default lock root), reconciles shared registrations, restores interval remaining time and expires past one-shots before any timer starts, registers the `/loop` autocomplete provider, and gates the due poller. Normal shutdown stops timers, persists suspension markers, then disposes via the `__scheduledWakeupInstance` pattern.
- `src/loop-command-handler.ts` — `/loop` command dispatch (add/define/available/register/unregister/list/stop/delete/run/defer/help) with human-readable list/available output and `reschedule()` after successful mutations; `/loop run` delivers immediately without advancing progress and requires a resolvable registration definition; `/loop defer` persists only the current session's next-run change and reports the new time.
- `src/v2/defer-active-task.ts` — lock-protected defer for active session tasks and registrations, through `LoopV2Core.deferActive()` and the user-only `UserLoopV2Commands.deferActiveTask()` facade; no new durable fields or shared-catalog writes.
- `src/v2/session-schedule-lifecycle.ts` / `src/v2/resume-progress.ts` — state-locked whole-session suspension/restoration, interval remaining-time recovery, and one-shot expiration; executors restore suspended registrations when unavailable catalogs recover.
- `src/v2/parse-v2-command.ts` — full v2 command grammar parser and help text.
- `src/v2/due-poller.ts` — adaptive poller (nearest `nextRunAt`, MAX_TIMEOUT chunking, unref unless `PI_SCHEDULED_WAKEUP_RUNNER=1`, 60s failure backoff, `reschedule()` hook).
- `src/v2/register-v2-tool.ts` — `scheduled_wakeup` tool (add/list/cancel/delete) converting `delay|at|interval` strings to `TaskSchedule`, rejecting `scope`/`force`, calling `onMutation()` after mutating actions.
- `src/v2/format-list.ts` — human-readable formatting for active tasks and available definitions.
- `src/v2/loop-command-autocomplete.ts` — now registered at `session_start`; covers the full grammar including `unregister`, `run`, `defer`, and `help`; `defer` offers current active IDs.

Covering tests: `test/parse-v2-command.test.ts`, `test/due-poller.test.ts`, `test/register-v2-tool.test.ts`, `test/extension.test.ts`, `test/defer-active-task.test.ts`, `test/defer-command.test.ts`, `test/schedule-lifecycle.test.ts`, `test/extension-resume.test.ts`, plus the retained `test/v2-*.test.ts` suites.

## Wiring rules

1. Construct one `LoopV2Core` with `ctx.sessionManager.getSessionId()`, `getBranch()`, and plain `pi.appendEntry()`.
2. During core initialization, call `reconcileSharedRegistrations()` and `resumeSchedules()` before starting the poller. During `session_start`, register `createLoopCommandAutocompleteProvider()` through `ctx.ui.addAutocompleteProvider()`. Pi drops wrappers on reload, so register it every start.
3. Give only `UserLoopV2Commands` to slash-command parsing. Parse `delete [--force] <definition-id>` explicitly, derive scope from the definition ID, and keep `--force` user-only.
4. Give only `AiSessionActions` to the AI tool. Its schema omits `scope` and `force`, and runtime rejects both if manually supplied.
5. The due poller (`src/v2/due-poller.ts`) calls `runDue()`. Delivery goes to Pi only after the core finds an executable definition/index pair.
6. `defer` is a user command only. Its successful next-run mutation persists before `reschedule()`; rejected commands leave progress and the armed timer unchanged. The existing executors and poller keep their delivery rules. See [the defer contract](detailed-design.md#defer-contract).

7. Normal `session_shutdown` stops the poller, persists active progress through `suspendSchedules()`, and disposes even if persistence throws. Resume counts no offline time toward a suspended interval; a past one-shot expires without delivery. The exact-close guarantee requires a successful shutdown snapshot, not a force-kill or crash. See [the close/resume contract](detailed-design.md#close-and-resume-contract).

## Force deletion boundary

Force deletion atomically removes the shared definition and every shared registration-index record. This is immediate shared invalidation: every old remote reference becomes unavailable before its next execution lookup. It is **not** atomic cross-session JSONL deletion. Offline sessions retain stale custom entries until their next `session_start` reconciliation; no implementation may rewrite their transcript files.

## Evidence status

- Real Pi session context test: done. Isolated sessions (gpt-5.6-luna and glm-5.3-flash) plus a live in-session test confirmed `scheduled-wakeup/v2/session-state` custom entries never enter model context; only delivered prompts do.
- Command/tool e2e: done. Real-plugin sessions exercised add/define/available/register/stop/delete, AI tool add/list, and structural absence of `scope` in the tool schema.
- Defer: implemented in commit `cb7cdccba`. Direct Node tests passed: 54 tests / 13 suites, including duration and absolute-time parsing, repeated/overdue defer, restart recovery, shared-session isolation, execution/state lock contention, append failure, command notifications, autocomplete, timer re-arming, and unchanged recurring intervals. Plugin TypeScript and root `npm run check` passed. The user separately confirmed direct `/loop` testing succeeded; that confirmation does not claim every automated case was exercised manually.
- Close/resume and expiration: all plugin Node tests passed, 67 tests / 15 suites; plugin TypeScript and root `npm run check` passed. `schedule-lifecycle.test.ts` covers remaining-time recovery, one-shot expiration, deferred deadlines, shared-session isolation, unavailable catalog recovery, atomic lifecycle snapshots, and abnormal-exit boundaries. `extension-resume.test.ts` drives the actual extension handlers and poller with a controlled clock and in-memory Pi host; a real Pi process close/reopen test remains for the user and is not claimed by these tests.
- Two real processes racing one registration: not yet run as a two-process e2e. Covered by `v2-execution.test.ts`, which drives two independently constructed cores for the same session through the same real `proper-lockfile` lock root and proves one gets `locked`.
- Reconciliation after force deletion: covered by `v2-shared-delete.test.ts` and the `session_start` wiring test in `extension.test.ts`.
- No Loop 1.x migration or import: verified by static scans; v1 sources were deleted outright.
