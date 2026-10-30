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
/loop register <ws|workspace|global> <id|name>  Register a shared definition
/loop unregister <registration-id|name>         Remove this session's registration
/loop list                                     Show active set, live runs and pending deliveries
/loop running                                  Toggle inline details (fullscreen only)
/loop show off|on                              Hide/show widget; does not stop tasks
/loop stop <id|name|all>                       Stop tasks, runs and pending deliveries
/loop delete [--force] <definition-id|name>    Delete a shared definition (scope from id prefix)
/loop run <id|name>                            Deliver the prompt now, progress unchanged
/loop defer <id|name> <duration|time...>         Postpone only the next scheduled delivery
/loop rename <id|name> <new-name...>           Name a task or shared definition; --clear removes the name
/loop help                                     Show command help
```

Durations support `s`, `m`, `h`, `d` (for example `10s`, `5m`, `2h`, `1d`). `at` accepts `12am tomorrow`, `09:30 +08:00`, or ISO timestamps; ambiguous zone abbreviations such as `PST` are rejected. Past or overflow times are errors.

Optional names identify items in `/loop list`, `/loop available`, and the widget (`name [id]`). Creation accepts a name through the AI tool's `name` field; `/loop rename` sets or clears (`--clear`) it afterwards — renaming a shared definition affects every session that registers it. Command targets resolve by exact id first, then by name; a name used by several candidates in the command's scope is rejected with the matching ids listed. `defer` takes a single-token id or name, so names containing spaces need the id there. A bare `delete <name>` (no `workspace:`/`global:` prefix) resolves across both scopes.

`defer` takes an active id (or single-token name) from `/loop list`. For example, `/loop defer session:abc 10m` adds ten minutes to the later of now and its current next run time; `/loop defer session:abc 12am tomorrow` sets an absolute time later than both. Repeated durations extend the delay. Only this session's progress changes, even for shared registrations; run counts and definitions stay unchanged, and restart follows the close/resume rules below. After delivery, recurring tasks resume their original interval measured from the actual delivery time, not the original clock cadence. Already delivered or queued prompts cannot be postponed. `defer` is user-only, not an AI tool action.

Deletion boundaries: `delete` succeeds only when no other session's index entry references the definition; `--force` (user commands only) atomically removes the definition and every registration-index record, making all old references unavailable immediately. Offline sessions clean up on their next `session_start` reconciliation.

## Script tasks and live progress

Put script options before the schedule; repeat `--script` with a JSON object for each executable:

```text
/loop add --script {"path":"/bin/sh","params":["./check.sh"]} --wake on-error --error-mode or 10m Handle failures
/loop add --script {"path":"./refresh.sh","cwd":"~/repo","timeoutSeconds":null} --wake never once 1m
/loop running
```

`--wake` is `always` (default), `on-error`, or `never`; `--error-mode` is `or` (default) or `and` and requires on-error. Each script defaults to cwd `.` / params `[]` / timeoutSeconds `1800`; null has no deadline. Paths are prepared against the creating context's cwd and stored absolute, including current-user `~/` expansion. Executables must be executable, or explicitly invoke `/bin/sh`; there is no PATH lookup, shell expansion, dependency inference or fail-fast. All scripts run sequentially, ordinary failures included, then one result card/custom message is sent. The delivered body carries the `<prompts>` block only when this run actually wakes (omitted for `never`, or `on-error` with no triggering failure); script blocks omit empty fields (`params: []`, null `signal`/`error`, empty `stdout`/`stderr`) while raw results keep every value. A never policy does not start a new AI run. Its result is appended at a safe message boundary and may become visible to an already-running AI before its final reply.

In fullscreen TUI, left-click anywhere on a `Loop ·` result card — title, body, or padding rows — to expand/collapse its model-facing body. Cards are independent; global Expand still works. Legacy TUI keeps keyboard Expand and does not receive fullscreen mouse events. This changes presentation only: no message is resent and no AI turn starts.

Default runtime text is short English: ` ◓ Loop · N scheduled`, `Waiting`, `Running`, `wake` / `no wake`. User prompts, paths and script output are never translated. In TUI modes the summary glyph slowly cycles `◓ ◑ ◒ ◐` (upper→right→lower→left, clockwise) every 600ms (cached lines only; rpc output stays static).

The above-editor widget summarizes current-session Loop items: scheduled prompts/scripts, live wrapper batches, and pending deliveries, merged by item ID; named items show `name · id`. Detail rows are `Running (I/K/M) <command>`, `Pending delivery (wake|no wake)`, or `Waiting <remaining>` with a queued-deliveries suffix; running and pending rows sort above waiting ones. Recurring items are not double-counted. N > 0 displays one summary line; N = 0 hides it. Fullscreen click (or `/loop running`) toggles inline details, never a separate dialog: at most 10 total lines including the summary, one item per detail row. Waiting rows count down; executing rows show I/K/M (successes / ended attempts, including failures and timeouts / total) plus the current command on the same truncated line. Legacy TUI is always one line and cannot expand, even through the command.

`/loop show off|on` changes only this session branch's display preference (default on), recorded in a custom entry and restored on reload/tree changes. It does not cancel or pause work; no persistent/global flags or settings-service dependency are added. Countdown repaint runs only while expanded waiting rows are visible, uses cached UI data and is cleaned on hide/close. Verified official Pi 1.2/1.3 public input-dock components are measured before expansion, leaving editor/footer plus a transcript row intact; insufficient or unrecognized layouts stay collapsed.

A scheduled dispatch increments runCount and advances the next deadline when it starts, not after the batch completes. Same-ID overlap is refused; missed intervals do not build a queue. Manual run leaves the schedule unchanged. Script batches execute in a detached wrapper process under `.pi/scheduled-wakeup/v2/runs/<taskId>/<runId>/` (task.json, live.sock, status.json, output/NN-*.log, result.json, delivered.json, cancelled.json, wrapper.pid); a run's lifecycle spans `running → pendingDelivery → done | cancelled`, terminating only on successful delivery. Output is persisted to the per-script logs; delivered bodies carry an 8 KiB tail plus the log paths. Closing or reloading the session never kills a run: the wrapper finishes on disk and the result waits for its owning session to return; ownership is exact session-id equality (compact and `pi -c` keep the id, forks do not) — a forked or bystander session fully disconnects from foreign runs (no display, delivery, synthesis, stop, GC, or disk contact): on seeing an active foreign run it cancels that task locally — its own tracking stops — and prints one info notice; the foreign run directory is never touched and lost wrappers are synthesized as failed results by the owner per the registered wake policy. Stop/cancel removes future scheduling and terminates live runs: running batches get SIGTERM (fallback SIGKILL plus a cancelled outcome), pending deliveries are retracted before they are ever sent; once a delivery action has executed it cannot be retracted. Idle sessions deliver immediately (wake starts a turn, no-wake appends); busy sessions hold deliveries in Loop's own queue and flush them at `agent_before_settle` (wake requests one final continuation; no-wake only appends entries), falling back to `agent_settled`. Crash windows redeliver at most once (send-then-mark ordering); terminal runs are garbage-collected after the newest 5 per task or 7 days, whichever keeps them.

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
action=add     prompt=<text> interval=10m name="nightly check"  # optional display name
action=list
action=cancel  id=<active task id or unique name; also terminates its live runs>
action=delete  id=<registration id or unique definition name>   # ordinary deletion via your own registration
```

For script tasks, use `scriptTask: {wakeUp: {kind: "on-error", aggregation: "or", prompt: "Handle failures"}, scripts: [{path: "./check.sh"}]}` instead of top-level `prompt`; the two are mutually exclusive. For `action=add`, provide exactly one of `delay`, `at`, or `interval`. The schema has no `scope` or `force` fields; supplying them at runtime is rejected. Results return short text content with `AiSessionActionResult` details (`ok`, `message`, `active`).

## Delivery and modes

The poller arms one timer at the nearest active `nextRunAt`, dispatches due work through a session-owned runner, and re-arms; waits longer than ~24.8 days are chunked. Delivery is self-managed: Loop never parks results in Pi's follow-up queue. Wake-enabled results `sendMessage` with `triggerTurn: true` the moment the session is idle; while an agent run is busy they wait in Loop's own pending set and join the run's final continuation through `agent_before_settle` entries (`continue: true` only when waking and the run did not abort); `agent_settled` flushes whatever remains. NoWake results append without starting a new run. Official Pi's visible pending-message list never includes these queued deliveries; cancelling a pending delivery is trivial because the message is still in Loop's hands. Failed, locked, or unavailable poller dispatches retry after a 60-second backoff instead of hot-looping; result delivery retries on the next scan tick (about once per second), and a failed prompt send stays pending for the next pump.

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

# True TUI end-to-end (tmux-driven real pi, real wrapper, real delivery):
PI_LOOP_E2E=1 PI_LOOP_TEST_SDK_ROOT="$HOME/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent" \
  node --import ./test/script-task-register.mjs --test --test-force-exit test/e2e-tui.test.ts
# Skipped without PI_LOOP_E2E=1 or when tmux/pi are unavailable.
```
