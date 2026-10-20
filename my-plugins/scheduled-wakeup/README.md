# scheduled-wakeup

Pi extension for in-process timed prompt wakeups, powered by Loop 2.0. Humans use `/loop`; AI agents use the `scheduled_wakeup` tool. Both share one Loop 2.0 core: session tasks live as Pi custom entries, shared definitions live in workspace/global catalogs, and a due poller delivers prompts on time.

Loop 1.x (`.pi/scheduled-wakeup/jobs.json` scheduler) has been removed entirely; there is no dual-track or compatibility layer.

## Scopes

| Scope | Durable owner | Runs automatically |
| --- | --- | --- |
| `session` | current session custom entries (`scheduled-wakeup/v2/session-state`) | when this session's poller fires |
| `workspace` | `<cwd>/.pi/scheduled-wakeup/v2/workspace-definitions.json` | only after a session registers it |
| `global` | `~/.pi/scheduled-wakeup/v2/global-definitions.json` | only after a session registers it |

A shared definition is never copied into a session: a registration stores `{scope, definitionId}` plus session-private progress, and a durable index record in the catalog. `active` means this session's running tasks and registrations; `available` means shared definitions this session has not registered.

## Commands

Creation (`add`, `define`, `register`, and tool `action=add`) requires an existing session file. An unsaved or in-memory session is rejected with an error asking for a real message first, before task/catalog mutation. Loop does not insert messages or trigger a model turn to create that file; queries remain available.

```text
/loop add <interval> <prompt...>               Session recurring task
/loop add once <delay> <prompt...>             Session one-shot task
/loop add at <time...> -- <prompt...>          Session one-shot at a clock time
/loop define <ws|workspace|global> <forms>     Shared definition (same forms as add)
/loop available [ws|workspace|global]          Unregistered shared definitions (default: both)
/loop register <ws|workspace|global> <id>      Register a shared definition
/loop unregister <registration-id>             Remove this session's registration
/loop list                                     Show this session's active set
/loop running                                  Toggle inline details (fullscreen only)
/loop show off|on                              Hide/show widget; does not stop tasks
/loop stop <id|all>                            Stop active tasks and registrations
/loop delete [--force] <definition-id>         Delete a shared definition (scope from id prefix)
/loop run <id>                                 Deliver the prompt now, progress unchanged
/loop defer <id> <duration|time...>             Postpone only the next scheduled delivery
/loop help                                     Show command help
```

Durations support `s`, `m`, `h`, `d` (for example `10s`, `5m`, `2h`, `1d`). `at` accepts `12am tomorrow`, `09:30 +08:00`, or ISO timestamps; ambiguous zone abbreviations such as `PST` are rejected. Past or overflow times are errors.

`defer` takes an active ID from `/loop list`. For example, `/loop defer session:abc 10m` adds ten minutes to the later of now and its current next run time; `/loop defer session:abc 12am tomorrow` sets an absolute time later than both. Repeated durations extend the delay. Only this session's progress changes, even for shared registrations; run counts and definitions stay unchanged, and restart follows the close/resume rules below. After delivery, recurring tasks resume their original interval measured from the actual delivery time, not the original clock cadence. Already delivered or queued prompts cannot be postponed. `defer` is user-only, not an AI tool action.

Deletion boundaries: `delete` succeeds only when no other session's index entry references the definition; `--force` (user commands only) atomically removes the definition and every registration-index record, making all old references unavailable immediately. Offline sessions clean up on their next `session_start` reconciliation.

## Script tasks and live progress

Put script options before the schedule; repeat `--script` with a JSON object for each executable:

```text
/loop add --script {"path":"/bin/sh","params":["./check.sh"]} --wake on-error --error-mode or 10m Handle failures
/loop add --script {"path":"./refresh.sh","cwd":"~/repo","timeoutSeconds":null} --wake never once 1m
/loop running
```

`--wake` is `always` (default), `on-error`, or `never`; `--error-mode` is `or` (default) or `and` and requires on-error. Each script defaults to cwd `.` / params `[]` / timeoutSeconds `1800`; null has no deadline. Paths are prepared against the creating context's cwd and stored absolute, including current-user `~/` expansion. Executables must be executable, or explicitly invoke `/bin/sh`; there is no PATH lookup, shell expansion, dependency inference or fail-fast. All scripts run sequentially, ordinary failures included, then one result card/custom message is sent. A never policy does not start a new AI run. Its result is appended at a safe message boundary and may become visible to an already-running AI before its final reply.

In fullscreen TUI, left-click a `Loop ·` result-card title to expand/collapse its model-facing body. Clicking the body does not toggle it. Cards are independent; global Expand still works. Legacy TUI keeps keyboard Expand and does not receive fullscreen mouse events. This changes presentation only: no message is resent and no AI turn starts.

Default runtime text is short English: `Loop · N scheduled`, `Waiting`, `Running`, `wake` / `no wake`. User prompts, paths and script output are never translated.

The above-editor widget summarizes current-session Loop items: scheduled prompts/scripts plus in-flight script batches, merged by item ID. Running once-items remain until their batch ends; recurring items are not double-counted. N > 0 displays one summary line; N = 0 hides it. Fullscreen click (or `/loop running`) toggles inline details, never a separate dialog: at most 10 total lines including the summary, one item per detail row. Waiting rows count down; executing rows show I/K/M (successes / ended attempts, including failures and timeouts / total) plus the current command on the same truncated line. Legacy TUI is always one line and cannot expand, even through the command.

`/loop show off|on` changes only this session branch's display preference (default on), recorded in a custom entry and restored on reload/tree changes. It does not cancel or pause work; no persistent/global flags or settings-service dependency are added. Countdown repaint runs only while expanded waiting rows are visible, uses cached UI data and is cleaned on hide/close. Verified official Pi 1.2/1.3 public input-dock components are measured before expansion, leaving editor/footer plus a transcript row intact; insufficient or unrecognized layouts stay collapsed.

A scheduled dispatch increments runCount and advances the next deadline when it starts, not after the batch completes. Same-ID overlap is refused; missed intervals do not build a queue. Manual run leaves the schedule unchanged. Stop/cancel removes future scheduling but lets the already-started batch finish, including its final wake decision. Session close/reload aborts owned processes and suppresses late results; it does not resume a partial batch or provide exactly-once after a crash.

## Boulder inhibition

`/loop add --no-boulder 10m <prompt>` and `/loop define workspace --no-boulder 10m <prompt>` persist `inhibitBoulder: true` in the definition. The flag is recognized before the prompt starts; in `at` form, text after `--` is literal prompt text. Tab offers the flag only in add/define option positions, not after prompt text or for available.

With OMP-v2 loaded, the current session's active special schedules hold a branch-local `loop=true` signal via its public service. The aggregate resynchronizes after mutation, completion, restoration, service readiness and branch refresh. Same-cwd session replacement uses a fresh runtime. Stopping the last special schedule closes only loop's source; other sources remain independent. An unreadable shared catalog is not treated as false.

`/task boulder set loop false` is a temporary manual reset; a later loop sync recomputes from active objects. Without the service, sync reports failure without throwing or pretending a signal was written. Broader storage/cache/lease limitations remain as documented; current contracts and incremental reasoning status: [Boulder integration](../oh-my-pi-v2/docs/boulder-inhibition/integration-contracts.md).

## AI tool

`scheduled_wakeup` supports session-scoped actions only:

```text
action=add     prompt=<text> delay=10m           # one-shot relative
action=add     prompt=<text> at="12am tomorrow"  # one-shot clock time
action=add     prompt=<text> at="2026-08-05T00:00:00Z"
action=add     prompt=<text> interval=10m        # recurring
action=add     prompt=<text> interval=10m inhibitBoulder=true # hold loop inhibition
action=list
action=cancel  id=<active task id>
action=delete  id=<registration id>              # ordinary deletion via your own registration
```

For script tasks, use `scriptTask: {wakeUp: {kind: "on-error", aggregation: "or", prompt: "Handle failures"}, scripts: [{path: "./check.sh"}]}` instead of top-level `prompt`; the two are mutually exclusive. For `action=add`, provide exactly one of `delay`, `at`, or `interval`. The schema has no `scope` or `force` fields; supplying them at runtime is rejected. Results return short text content with `AiSessionActionResult` details (`ok`, `message`, `active`).

## Delivery and modes

The poller arms one timer at the nearest active `nextRunAt`, dispatches due work through a session-owned runner, and re-arms; waits longer than ~24.8 days are chunked. Wake-enabled results use `deliverAs: "followUp"`: when busy they enter the agent follow-up queue; when idle they start a turn directly. Official Pi's visible pending-message list does not include these custom-message queues. NoWake results do not enter the AI follow-up queue; they append without starting a new run, deferred to a safe tool/turn boundary if busy—not necessarily until the whole response ends. Failed, locked, or unavailable deliveries retry after a 60-second backoff instead of hot-looping.

Commands and the tool are registered in every mode. The poller starts in `tui`/`rpc` mode. In `print`/`json` mode it starts only with `PI_SCHEDULED_WAKEUP_RUNNER=1`; in that runner mode timers stay referenced so `pi -p` stays alive until work completes. Otherwise timers are unref'd.

This is not an OS daemon. Timers fire only while a Pi process is alive. On normal session shutdown, active progress saves `suspendedAt`. Resuming the same session restores interval countdowns: closing with three minutes left means reopening with three minutes left, regardless of time spent closed. One-shot deadlines stay absolute: if the next-run time has passed on reopen, the task becomes `expired` without delivery or a run-count increment. A deferred one-shot uses its new deadline. Expired tasks are absent from `/loop list`; reload and session replacement use the same lifecycle.

A force-kill, crash, or failed shutdown save cannot provide an exact close time. Without a saved marker, intervals retain their persisted deadline and may deliver one overdue run on recovery; past one-shots still expire. An unavailable shared definition keeps its suspension marker until it can be resolved. Normal online timer lateness is not treated as expiration.

## Shared-catalog locking

Shared tasks remain in JSON catalogs. Writes retain the existing proper-lockfile directory lock with a 30-second stale timeout and no contention retries. A writer that stops refreshing for over 30 seconds and later resumes can overwrite a newer update; the user explicitly accepts this boundary. No SQLite or additional writer process is used.

## Verification

```bash
cd my-plugins/scheduled-wakeup
# Point PI_LOOP_TEST_SDK_ROOT at the installed official package containing dist/index.js.
PI_LOOP_TEST_SDK_ROOT="$HOME/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent" node --import ./test/script-task-register.mjs --test test/*.test.ts
PI_LOOP_TEST_SDK_ROOT="$HOME/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent" node test/check-types.mjs
# The checker binds the installed official SDK/TUI declarations, not stale workspace dist.
```
