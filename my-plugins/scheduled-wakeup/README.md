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

```text
/loop add <interval> <prompt...>               Session recurring task
/loop add once <delay> <prompt...>             Session one-shot task
/loop add at <time...> -- <prompt...>          Session one-shot at a clock time
/loop define <ws|workspace|global> <forms>     Shared definition (same forms as add)
/loop available [ws|workspace|global]          Unregistered shared definitions (default: both)
/loop register <ws|workspace|global> <id>      Register a shared definition
/loop unregister <registration-id>             Remove this session's registration
/loop list                                     Show this session's active set
/loop stop <id|all>                            Stop active tasks and registrations
/loop delete [--force] <definition-id>         Delete a shared definition (scope from id prefix)
/loop run <id>                                 Deliver the prompt now, progress unchanged
/loop help                                     Show command help
```

Durations support `s`, `m`, `h`, `d` (for example `10s`, `5m`, `2h`, `1d`). `at` accepts `12am tomorrow`, `09:30 +08:00`, or ISO timestamps; ambiguous zone abbreviations such as `PST` are rejected. Past or overflow times are errors.

Deletion boundaries: `delete` succeeds only when no other session's index entry references the definition; `--force` (user commands only) atomically removes the definition and every registration-index record, making all old references unavailable immediately. Offline sessions clean up on their next `session_start` reconciliation.

## AI tool

`scheduled_wakeup` supports session-scoped actions only:

```text
action=add     prompt=<text> delay=10m           # one-shot relative
action=add     prompt=<text> at="12am tomorrow"  # one-shot clock time
action=add     prompt=<text> at="2026-08-05T00:00:00Z"
action=add     prompt=<text> interval=10m        # recurring
action=list
action=cancel  id=<active task id>
action=delete  id=<registration id>              # ordinary deletion via your own registration
```

For `action=add`, provide exactly one of `delay`, `at`, or `interval`. The schema has no `scope` or `force` fields; supplying them at runtime is rejected. Results return short text content with `AiSessionActionResult` details (`ok`, `message`, `active`).

## Delivery and modes

The poller arms one timer at the nearest active `nextRunAt`, delivers due work, and re-arms; waits longer than ~24.8 days are chunked. When Pi is busy the prompt is queued with `deliverAs: "followUp"`; when idle it starts a turn directly. Failed, locked, or unavailable deliveries retry after a 60-second backoff instead of hot-looping.

Commands and the tool are registered in every mode. The poller starts in `tui`/`rpc` mode. In `print`/`json` mode it starts only with `PI_SCHEDULED_WAKEUP_RUNNER=1`; in that runner mode timers stay referenced so `pi -p` stays alive until work completes. Otherwise timers are unref'd.

This is not an OS daemon. Timers fire only while a Pi process is alive; overdue work fires when the session starts again.

## Verification

```bash
npm test --prefix my-plugins/scheduled-wakeup
npx tsc -p my-plugins/scheduled-wakeup/tsconfig.json
```
