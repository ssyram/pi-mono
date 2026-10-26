# Loop 2.0 Detailed Design

## State invariants

1. Session snapshots are version 1 with unique task IDs, registration IDs, and local `{scope, definitionId}` references. Definitions and `TaskInput` carry an optional display `name` (trimmed non-empty when present); it never affects IDs, references, locks, or uniqueness — command targets resolve by exact id first, then by a name that is unique within the command's candidate set.
2. A registration contains only `id`, `reference`, `progress`, and `registeredAt`; no copied prompt or schedule.
3. A version-2 shared catalog contains only its selected scope's definitions and index entries. Index entries have no execution progress.
4. Every executable shared registration has a matching catalog definition and index entry for its stable `sessionId` and registration ID.
5. Progress belongs only to a session task/registration. Force deletion may invalidate remote local references but never overwrites another session JSONL.

## Script content and running batches

TaskContent is a mutually exclusive prompt/scriptTask union. Creation prepares relative/home paths against ctx.cwd and persists absolute ScriptSpec values. cloneTaskContent copies policy/scripts/params; readTaskContent refuses conflicting or malformed payloads rather than downgrading to a prompt. The session/shared decoder preserves all fields; registration records still contain only references/private progress.

Dispatch returns synchronously once a batch starts; core runCount/nextRunAt advance then. Dispatcher refuses same-ID overlap, sequentially awaits every ordinary script result, and sends one `loop-task-run` custom message. Never uses triggerTurn:false (no extra turn; future context can include it); wake policies use true/followUp. Ordinary runner/publication/hook failures are contained and reported; UI errors cannot rewrite committed schedule progress. No crash exactly-once claim or new retry system is introduced.

The widget merges listActive() schedules with dispatcher.list() by ID; running once-items remain until completion, and running recurring items count once. It displays a single summary while N>0 and removes itself at N=0. Fullscreen click on the summary or /loop running toggles inline details, max10 total lines (summary+up to9 items). Each item is exactly one line: waiting remaining time, or executing I/K/M and current command. I=success terminals, K=all ended attempts (not current), M=script count. Legacy has no mouse handler and /loop running cannot expand it; the old overlay is gone.

Space checks use the public TUI children/render API of the verified Pi1.2 seven-component mount: document then six fixed input-dock components. During measurement our renderer returns only the summary, preventing recursion; actual dock heights include other widgets and editor, with one transcript row reserved. If our summary is not observed, mount shape differs, or insufficient height remains, do not expand; resize may collapse it. No private field/method or host modification is used.

Widget snapshots refresh at start/tree, command/tool mutation, due-run and runner progress. The countdown interval merely requests render of cached waiting deadlines while expanded; hidden/collapsed/legacy/closed states have no countdown timer. loop-widget-visibility.ts reads the latest legal scheduled-wakeup/widget-visibility custom record, default true. show off/on appends that record before applying UI state; failures report possible partial effects, never promise rollback. It is session/branch-local like tasking's default show behavior, without adding persistent/global parameters or a settings-service dependency. Display toggles never touch schedules or running children. Public UI/timer/render callbacks contain ordinary failures, and sanitization/truncation is display-only.

Stop/cancel leaves an already-started batch running and may still yield its final wakeup. Session shutdown/reload disposes its runner/widget: optional AbortSignal kills only owned groups, removes listeners/timers on settlement, prevents new children after cancellation and suppresses results on an invalidated context. Partial batches are not resumed. Existing detached-descendant/OS kill refusal limits remain.

## Session state and progress

Creation at Pi-facing command/tool boundaries requires an existing regular file at `ctx.sessionManager.getSessionFile()`. Missing/undefined/non-file paths return an error before any creation, shared index write or append; notification is best-effort and cannot escape. Commands gate `add`/`define`/`register`, the tool gates only `add`; queries remain usable. Once a real conversation saves the file, the same runtime can create tasks without reload. This does not certify later writes or force Pi to persist a custom-only session, and does not add synthetic messages/provider calls/storage.

One session transcript has one executor by user contract; multiple executors for the same transcript are UB. No freshness repair or owner-admission layer is required for that case. Different session transcripts still share catalog transactions.

`SessionEntryAdapter.reload()` recovers the newest valid custom snapshot. `dispatch()` computes the reducer result, appends it, then updates memory. Single schedules complete after successful dispatch; intervals advance to dispatch time plus intervalMs. A later script failure is a batch result, not a failed dispatch/retry.

## Close and resume contract

User-confirmed behavior: an interval with three minutes remaining at normal session shutdown resumes with three minutes remaining, regardless of time spent closed. A one-shot whose next-run timestamp is earlier than resume time expires without delivery; a timestamp equal to resume time is due, not expired. This applies to both one-shot creation forms (`once <delay>` and `at <time>`), which store absolute deadlines, and uses a deferred `nextRunAt` rather than the original definition time.

Normal `session_shutdown` stops the poller and appends active progress with `suspendedAt`. On resume, each interval becomes `nextRunAt = resumeTime + max(0, oldNextRunAt - suspendedAt)` and drops the suspension marker. Future one-shots retain their absolute `nextRunAt`; past one-shots become `status: expired` with `expiredAt`, without changing run count or last run. Completed/expired progress is unchanged. The state lock protects each whole-session lifecycle snapshot. Reconciliation and resume finish before any timer starts.

Shared definitions and index membership remain unchanged. If a shared catalog is unavailable, its suspended registration is preserved and restored only after definition/index resolution succeeds; the existing retry path provides this opportunity. No prompt or schedule is copied into a registration. Reload and session replacement use the same shutdown/start lifecycle.

A crash or force-kill may skip shutdown, so exact remaining time cannot be recovered without a saved marker. Such intervals retain their last persisted deadline, with the existing at-most-one overdue delivery on recovery; one-shots still expire if past. Shutdown persistence failure similarly cannot guarantee a saved countdown. No heartbeat or daemon is introduced. Normal online delivery uses existing due checks; ordinary timer lateness is not a reason to expire a running task.

## Defer contract

`/loop defer <active-id> <duration|time...>` updates only the current session task/registration's active `progress.nextRunAt`. A duration adds to `max(now, nextRunAt)`; an absolute time must exceed both `now` and `nextRunAt`. Durations must be positive safe integers; the resulting timestamp must be a safe integer representable by JavaScript `Date`. Missing, completed, busy, invalid, and overflow targets do not change state or re-arm the timer. The operation acquires the target's execution lock, then the session state lock, reloads progress, and persists through the existing progress action. It preserves the definition, registration index, run count, and last run time. Repeated duration commands extend the current next run time.

The command re-arms the poller. Successful execution then uses the existing rules: a one-shot completes; an interval schedules `actual execution time + intervalMs`. No original clock cadence is restored. The persisted delay survives restart under the close/resume contract: interval countdowns pause while closed, whereas one-shot deadlines remain absolute and can expire. Already delivered or queued prompts cannot be deferred. This is a user-command-only surface, not an AI tool action.

## Shared catalog transaction

`SharedDefinitionStore` acquires the existing proper-lockfile directory lock before loading/validating the scope catalog, applies one operation, writes a temporary JSON file, then atomically renames it while holding the lock. `create`, `rename`, `indexRegistration`, `removeRegistration` and `delete` use this write transaction. Queries retain lock-free complete snapshots. Lock contention returns `busy` for deletion and an internal busy error for other writes; malformed catalogs are unavailable rather than partly accepted.

`lockfile.lockSync(path, { realpath: false, retries: 0, stale: 30000, onCompromised: () => undefined })` creates the existing `.lock` directory. The library refreshes its timestamp when the event loop runs, and another writer may reclaim it after 30 seconds without refresh. Finally releases the lock, ignoring an already-stale release failure. The user explicitly accepts that a writer paused/blocked beyond this interval and later resumed can overwrite an intervening update. This is not strict exclusion under arbitrary process suspension. SQLite, fencing, auxiliary writer processes and stronger pause/crash guarantees are deliberately excluded.

### Registration ordering

```text
catalog index add -> append session registration
append session removal -> catalog index removal
```

The first order prevents an unindexed local registration from executing. The second means a crash can leave an index that blocks normal deletion, which is conservative. Both operations are idempotent: existing matching index/local registration is reused; absent local/index removal is harmless. Reconciliation removes a local registration only when a valid catalog confirms its definition or index is missing; an unreadable catalog preserves the local reference while execution remains unavailable.

## Delete contract

```ts
type SharedDeleteResult =
  | { kind: "deleted" }
  | { kind: "missing" }
  | { kind: "registered-by-others" }
  | { kind: "busy" };
```

- User `delete(scope, definitionId, false)` deletes only if every index entry is this session's.
- User `delete(scope, definitionId, true)` removes the definition and every matching index entry under the same catalog lock.
- AI `delete(registrationId)` uses the ordinary rule for that registration's referenced definition. It rejects any `force` or `scope` input.
- After a successful local delete, this session removes its matching local registration. Other sessions retain old snapshots until `reconcileSharedRegistrations()` runs; their executors return `unavailable` immediately because the catalog definition/index is gone.

## Command autocomplete

`createLoopCommandAutocompleteProvider(current, source)` wraps Pi's current autocomplete provider. It claims forced Tab after `/loop `, uses case-insensitive subsequence matching, and delegates unsupported positions to the wrapped provider. Candidates: top-level `add`, `define`, `available`, `register`, `unregister`, `list`, `running`, `show`, `stop`, `delete`, `run`, `defer`, `rename`, `help`; shared scopes; active task labels and shared definition labels (values are ids, descriptions show names; unregister offers only `registration:*` ids); `--force`. The source interface is `taskLabels()` / `definitionLabels(scopes?)` returning `{id, name?}`; `src/extension.ts` registers it on every `session_start`.

## Boulder lifecycle and completion

`inhibitBoulder` is an optional definition boolean (default false), persisted by core/codec and accepted by tool schema plus AI input validation. CLI `--no-boulder` is recognized only before free prompt text (after `at`'s `--` it is literal); add/define Tab candidates follow the same boundary, including `ws` alias, and never apply to available.

`create-loop-runtime` builds session-bound core/actions/bridge/poller; ensure compares cwd, manager and session ID. Bridge sync uses actual session tasks plus active registrations with resolved/missing/unavailable semantics. An indexed record whose definition read fails is unavailable, not resolved false. Mutation/afterRun/start/tree/OMP-ready recompute through the public service. Failed sync reports inside its catch and does not fake rollback or add schedules.

Each completion method contains its operations and delegation; getSuggestions awaits the delegate to capture Promise rejection. Current pre/post, branches, failure termination and loop reasoning are delegated to [Boulder integration contracts](../../../oh-my-pi-v2/docs/boulder-inhibition/integration-contracts.md), not a second copy of the same rules.

## Runtime wiring

`claimLoopInstance(manager, dispose)` keeps reload ownership keyed by the public SessionManager object. Claiming that same object disposes only its previous instance; another manager, even in the same cwd, is independent. Release removes only the matching claim, so a retired callback cannot remove its successor. Extension teardown marks its closure inactive and releases its own claim; retired tools cannot recreate the runtime. The process-level WeakMap is only identity-keyed lifecycle bookkeeping, not shared task state. Manager replacement releases the old claim and the existing ensure path disposes/rebuilds that instance's runtime.

- `parse-v2-command.ts` parses the full `/loop` grammar (see README for the surface) into the dispatch union; `interval`/`delay` reuse `src/parse-duration.ts`. Creation `at` expressions reuse `src/parse-at-time.ts` and require the `--` prompt separator. `defer` takes one active id (single-token id or name) followed by the entire duration/time expression, with no prompt separator. `delete` derives scope from the id prefix (bare names resolve across both scopes at dispatch) and accepts `--force` anywhere in the token list. `rename <id|name> <new-name...>` / `rename <id|name> --clear` sets or clears a definition name; `--clear` is only valid as the sole trailing token.
- `due-poller.ts` arms one timer at the nearest active `nextRunAt`, chunks waits beyond `MAX_TIMEOUT` (~24.8 days), runs `core.runDue(deliver)` on fire, and re-arms. Non-`executed` outcomes (failed/locked/unavailable/not-due-due-to-race) arm the next timer no sooner than 60s later to avoid hot-looping. Handles are unref'd unless `PI_SCHEDULED_WAKEUP_RUNNER=1`. `extension.ts` calls `reschedule()` after every mutating command and tool action.
- `register-v2-tool.ts` converts exactly one of `delay`/`at`/`interval` strings into a `TaskSchedule` before dispatching to `AiSessionActions`; `scope` and `force` are absent from the schema and rejected at runtime if supplied. `add` accepts an optional `name`; `cancel`/`delete` resolve `id` as an exact id or a unique name through the same resolver as user commands.
- `loop-command-handler.ts` implements `run <id|name>` as immediate delivery without progress advancement (a registration requires a resolvable definition), `stop all` as sequential `cancelActive` over the current active set, and `defer <id|name> <duration|time...>` through the user facade. Stop/run/defer/unregister/register/delete/rename targets first go through `resolve-target.ts` (exact id, then a name unique in that command's candidates; ambiguity reports the matching ids). Successful defer notifies the new time and re-arms the poller; rejected commands report the reason without mutation and without re-arming. Shared-definition renames use the definition-store transaction; session-task renames use the state lock.
- `defer-active-task.ts` implements the defer contract through the existing `advance-task`/`advance-registration` snapshot actions. The action names do not imply a run-count increment; defer replaces only `nextRunAt`.

## Correctness boundaries

Definition/index mutation uses atomic per-file replacement, but external Pi delivery and session entry append cannot be one transaction. Same-transcript multiple executors are outside the supported contract. Different-session catalog writers retain the existing expiring directory lock; the user accepts the long-pause lost-update boundary recorded in [the findings](../script-tasks/audit/cca-findings.md). Force invalidates future resolution immediately but cannot revoke a delivery already in progress. Pi may change its in-memory branch before a failed append, and custom-only sessions may not be flushed (creation is now rejected while their file is absent); append return/throw is not an unconditional durable-commit or rollback signal.

## Ordinary error containment

`extension.ts` contains factory, command and lifecycle failures, including setup/teardown/reporting. Internal core/store/port methods still raise errors where their contracts require it. The tool boundary also contains getActions/conversion/action failures; active-query failure is `null` with an error rather than zero tasks. Post-action refresh failure reports separately without rewriting the committed action outcome. `DuePoller.reschedule()` returns `{ok:true}` or `{ok:false,message,cause?}`; stopped/disposed pollers return failure rather than pretending that polling resumed. The command, lifecycle and tool adapters consume that failure without throwing or retrying; a committed action remains committed and its message identifies the schedule-refresh failure. Notifications do not belong to the delivery try.

The completion provider catches its own source operations and awaits async delegation within try; failure yields no suggestions, unchanged text/cursor, or false trigger. The existing poller start path can still propagate to the containing startup boundary; reschedule now clears running state and returns explicit failure, containing cleanup failure too. The actual timer callback additionally contains re-arm/diagnostic failures and stops rather than adding a new retry policy. Delegates receive copied editor arrays, and error-message conversion occurs inside its own try, including a non-string Error.message. These repairs are not a proof that every existing internal function is nonthrowing; current CCA coverage/SDK/usability boundaries are recorded in [the CCA4 adjudication](../../../oh-my-pi-v2/docs/task-system/cca4-findings.md).

`valid-once-time.ts` establishes new once timestamps in `(0, 8640000000000000]`; safe sums outside this range are invalid. `format-timestamp.ts` retains readable epoch-ms output for existing out-of-range values. `shared-catalog-codec.ts` owns complete scope/identity validation and unique registration pairs; `atomic-catalog-write.ts` owns temporary replacement and best-effort failure cleanup while preserving the primary write error. Other splits (`create-loop-core`, `runner-mode`, `run-prompt-now`, completion candidates) isolate existing responsibilities to retain the source-file limit, not add features.

Regression tests and residual boundaries are in [the correction contract](../script-tasks/outer-boundary-fix.md) and [test evidence](../script-tasks/test-report.md).
