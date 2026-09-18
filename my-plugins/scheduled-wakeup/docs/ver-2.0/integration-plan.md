# Loop 2.0 Integration Plan

## Current status

Loop 2.0 is integrated and is the only implementation. Loop 1.x (`src/scheduler.ts`, `src/job-store.ts`, `src/register-scheduled-wakeup-tool.ts`, `src/parse-loop-command.ts`, `src/format-job.ts`, `src/types.ts`) was deleted together with its v1 tests; no dual-track or compatibility layer remains.

Actual wiring files:

- `src/extension.ts` — session_start builds `LoopV2Core` (session id, branch entries via `getBranch()` + `pi.appendEntry()`, workspace root `ctx.cwd`, global root `os.homedir()`, default lock root), reconciles shared registrations, registers the `/loop` autocomplete provider, gates and starts the due poller, and disposes on reload/shutdown via the `__scheduledWakeupInstance` pattern.
- `src/loop-command-handler.ts` — `/loop` command dispatch (add/define/available/register/unregister/list/stop/delete/run/help) with human-readable list/available output and `reschedule()` after every mutating command; `/loop run` delivers immediately without advancing progress and requires a resolvable registration definition.
- `src/v2/parse-v2-command.ts` — full v2 command grammar parser and help text.
- `src/v2/due-poller.ts` — adaptive poller (nearest `nextRunAt`, MAX_TIMEOUT chunking, unref unless `PI_SCHEDULED_WAKEUP_RUNNER=1`, 60s failure backoff, `reschedule()` hook).
- `src/v2/register-v2-tool.ts` — `scheduled_wakeup` tool (add/list/cancel/delete) converting `delay|at|interval` strings to `TaskSchedule`, rejecting `scope`/`force`, calling `onMutation()` after mutating actions.
- `src/v2/format-list.ts` — human-readable formatting for active tasks and available definitions.
- `src/v2/loop-command-autocomplete.ts` — now registered at `session_start`; covers the full grammar including `unregister`, `run`, and `help`.

Covering tests: `test/parse-v2-command.test.ts`, `test/due-poller.test.ts`, `test/register-v2-tool.test.ts`, `test/extension.test.ts`, plus the retained `test/v2-*.test.ts` suites.

## Wiring rules

1. Construct one `LoopV2Core` with `ctx.sessionManager.getSessionId()`, `getBranch()`, and plain `pi.appendEntry()`.
2. During `session_start`, first call `reconcileSharedRegistrations()` and register `createLoopCommandAutocompleteProvider()` through `ctx.ui.addAutocompleteProvider()`. Pi drops wrappers on reload, so register it every start.
3. Give only `UserLoopV2Commands` to slash-command parsing. Parse `delete [--force] <definition-id>` explicitly, derive scope from the definition ID, and keep `--force` user-only.
4. Give only `AiSessionActions` to the AI tool. Its schema omits `scope` and `force`, and runtime rejects both if manually supplied.
5. A future session-owned poller calls `runDue()`. Delivery goes to Pi only after the core finds an executable definition/index pair.

## Force deletion boundary

Force deletion atomically removes the shared definition and every shared registration-index record. This is immediate shared invalidation: every old remote reference becomes unavailable before its next execution lookup. It is **not** atomic cross-session JSONL deletion. Offline sessions retain stale custom entries until their next `session_start` reconciliation; no implementation may rewrite their transcript files.

## Evidence before wiring

- Real Pi session test: custom entries absent from model context.
- Command/tool tests: shared operations unreachable from AI syntax; `force` rejected by AI.
- Two real processes with one session ID: one delivery.
- Reconciliation test after force deletion and a diff review proving no Loop 1.x migration/import.
