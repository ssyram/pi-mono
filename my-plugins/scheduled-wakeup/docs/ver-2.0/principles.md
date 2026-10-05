# Loop 2.0 Principles

## Q — confirmed questions

1. The default owner is the current session. Its task state and execution progress are Pi plain custom entries, persisted but absent from LLM context.
2. `workspace` and `global` are shared definition libraries. Defining one never schedules work until a session explicitly registers it.
3. `/loop list` means this session's active set; `available` means this session's unregistered shared definitions. Reading either has no mutation.
4. A shared registration is a reference plus session-private progress. Several sessions may register one definition independently.
5. User commands may create, register, delete, and force-delete shared definitions. The AI surface is session-only: it may cancel its own local task or registration and may request ordinary deletion through its own registration, but cannot supply `scope` or `force`.
6. Users may temporarily defer the next scheduled delivery of an active local task or shared registration in their current session. The task definition and interval remain unchanged; other sessions are unaffected. The user approved the duration/absolute-time forms and resuming from actual delivery time, then confirmed manual `/loop` testing succeeded. `defer` is not an AI tool action.

7. User clarification: interval countdowns pause while the session is closed; closing with three minutes left means reopening with three minutes left, not resetting a full interval or immediately replaying missed offline runs. Past one-shot deadlines expire rather than being delivered on reopen.

## P — principles

- Durable state lives with its owner: session progress in custom entries; shared definitions and registration membership in the selected shared catalog.
- A registration never copies prompt or schedule. A deleted definition therefore makes every old reference unavailable immediately.
- Shared authorization is structural. The slash-command surface is `UserLoopV2Commands`; the AI tool receives only `AiSessionActions`.
- The core is scheduler-neutral. No v2 module registers Pi commands, tools, lifecycle hooks, or timers on import; all runtime wiring lives in `src/extension.ts`.
- Delivery remains at-least-once across a crash after external delivery and before state persistence.
- Deferring changes only the owning session's active `nextRunAt`, without execution, run-count increments, or last-run changes. The persisted delay survives restart, and completed tasks cannot be reactivated by deferring.

## D — decisions

- Session snapshots use custom type `scheduled-wakeup/v2/session-state`; the newest valid active-branch snapshot wins.
- Each workspace/global catalog is one locked, atomically replaced JSON document containing definitions and a durable registration index. An index entry contains only `scope`, `definitionId`, `sessionId`, `registrationId`, and `registeredAt`.
- Registration writes the catalog index before its session snapshot. Unregistration writes the session snapshot before the index. A crash can leave a conservative stale index, never an executable unindexed registration.
- Normal deletion succeeds only without another session's index entry. User `--force` atomically removes a definition and every index entry. It invalidates old references immediately; it does not rewrite offline sessions' JSONL.
- `reconcileSharedRegistrations()` removes a current session's local registrations only when a valid catalog confirms the matching definition/index is absent. An unreadable catalog preserves the reference but blocks execution. Session start calls reconciliation.
- Runtime wiring (user-approved): `session_start` builds the core with `ctx.cwd` as workspace root and `os.homedir()` as global root, reconciles, registers the `/loop` autocomplete provider, and starts an adaptive due poller. The poller arms one timer at the nearest `nextRunAt` (chunked past ~24.8 days), delivers via `followUp` when the session is busy, backs off 60s after non-executed outcomes, stays unref'd except under `PI_SCHEDULED_WAKEUP_RUNNER=1`, and is gated off in `print`/`json` mode without that env.

- Defer uses the existing task/registration execution lock followed by the session state lock, reloads current progress, and persists through the existing progress actions. No new state format, shared-catalog mutation, or pause state is needed. The command re-arms the poller after success. Timing rules, repeated defer, rejected inputs, and the already-queued delivery boundary are specified in [the defer contract](detailed-design.md#defer-contract).

- Normal shutdown persists `suspendedAt` with active progress. Resume restores interval remaining time and marks past one-shots `expired`, preserving execution history. A whole-session progress snapshot is written under the state lock before timers start. Unresolved shared registrations keep their suspension marker until their definition can be resolved. See [the close/resume contract](detailed-design.md#close-and-resume-contract) for time boundaries and abnormal-exit limitations.

## I — implemented boundary

Loop 2.0 is wired and is the only implementation. `src/v2/` additionally hosts the integration adapters `parse-v2-command.ts`, `due-poller.ts`, `register-v2-tool.ts`, and `format-list.ts`; `src/extension.ts` and `src/loop-command-handler.ts` perform the wiring (command dispatch, tool registration, poller gating, autocomplete registration). Loop 1.x sources and tests were removed entirely — no dual-track, no compatibility layer. `session-schedule-lifecycle.ts` and `resume-progress.ts` implement shutdown countdown persistence, restart restoration, and one-shot expiration. `defer-active-task.ts` implements the lock-protected progress change, exposed through `LoopV2Core.deferActive()` and `UserLoopV2Commands.deferActiveTask()`; parsing, dispatch, help, and active-ID autocomplete include `/loop defer`. Tests live in `test/v2-*.test.ts`, `test/parse-v2-command.test.ts`, `test/due-poller.test.ts`, `test/register-v2-tool.test.ts`, `test/extension.test.ts`, `test/defer-active-task.test.ts`, `test/defer-command.test.ts`, `test/schedule-lifecycle.test.ts`, and `test/extension-resume.test.ts`; design remains in this directory.
