# Loop 2.0 Detailed Design

## State invariants

1. Session snapshots are version 1 with unique task IDs, registration IDs, and local `{scope, definitionId}` references.
2. A registration contains only `id`, `reference`, `progress`, and `registeredAt`; no copied prompt or schedule.
3. A version-2 shared catalog contains only its selected scope's definitions and index entries. Index entries have no execution progress.
4. Every executable shared registration has a matching catalog definition and index entry for its stable `sessionId` and registration ID.
5. Progress belongs only to a session task/registration. Force deletion may invalidate remote local references but never overwrites another session JSONL.

## Session state and progress

`SessionEntryAdapter.reload()` recovers the newest valid custom snapshot. `dispatch()` computes the reducer result, appends it, then updates memory. Single tasks complete after success; interval tasks advance to `now + intervalMs`; failed delivery does not advance.

## Close and resume contract

User-confirmed behavior: an interval with three minutes remaining at normal session shutdown resumes with three minutes remaining, regardless of time spent closed. A one-shot whose next-run timestamp is earlier than resume time expires without delivery; a timestamp equal to resume time is due, not expired. This applies to both one-shot creation forms (`once <delay>` and `at <time>`), which store absolute deadlines, and uses a deferred `nextRunAt` rather than the original definition time.

Normal `session_shutdown` stops the poller and appends active progress with `suspendedAt`. On resume, each interval becomes `nextRunAt = resumeTime + max(0, oldNextRunAt - suspendedAt)` and drops the suspension marker. Future one-shots retain their absolute `nextRunAt`; past one-shots become `status: expired` with `expiredAt`, without changing run count or last run. Completed/expired progress is unchanged. The state lock protects each whole-session lifecycle snapshot. Reconciliation and resume finish before any timer starts.

Shared definitions and index membership remain unchanged. If a shared catalog is unavailable, its suspended registration is preserved and restored only after definition/index resolution succeeds; the existing retry path provides this opportunity. No prompt or schedule is copied into a registration. Reload and session replacement use the same shutdown/start lifecycle.

A crash or force-kill may skip shutdown, so exact remaining time cannot be recovered without a saved marker. Such intervals retain their last persisted deadline, with the existing at-most-one overdue delivery on recovery; one-shots still expire if past. Shutdown persistence failure similarly cannot guarantee a saved countdown. No heartbeat or daemon is introduced. Normal online delivery uses existing due checks; ordinary timer lateness is not a reason to expire a running task.

## Defer contract

`/loop defer <active-id> <duration|time...>` updates only the current session task/registration's active `progress.nextRunAt`. A duration adds to `max(now, nextRunAt)`; an absolute time must exceed both `now` and `nextRunAt`. Durations must be positive safe integers; the resulting timestamp must be a safe integer representable by JavaScript `Date`. Missing, completed, busy, invalid, and overflow targets do not change state or re-arm the timer. The operation acquires the target's execution lock, then the session state lock, reloads progress, and persists through the existing progress action. It preserves the definition, registration index, run count, and last run time. Repeated duration commands extend the current next run time.

The command re-arms the poller. Successful execution then uses the existing rules: a one-shot completes; an interval schedules `actual execution time + intervalMs`. No original clock cadence is restored. The persisted delay survives restart under the close/resume contract: interval countdowns pause while closed, whereas one-shot deadlines remain absolute and can expire. Already delivered or queued prompts cannot be deferred. This is a user-command-only surface, not an AI tool action.

## Shared catalog transaction

`SharedDefinitionStore` locks one scope file, loads/validates its complete catalog, applies one operation, writes a temporary JSON file, then atomically renames it. `create`, `indexRegistration`, `removeRegistration`, `delete`, and definition/index checks use this transaction. Normal lock contention returns `busy` for deletion; malformed catalogs are unavailable rather than partly accepted.

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

`createLoopCommandAutocompleteProvider(current, source)` wraps Pi's current autocomplete provider. It claims forced Tab after `/loop `, uses case-insensitive subsequence matching, and delegates unsupported positions to the wrapped provider. Candidates: top-level `add`, `define`, `available`, `register`, `unregister`, `list`, `stop`, `delete`, `run`, `defer`, `help`; shared scopes; active IDs (unregister offers only `registration:*` IDs); `--force`; and shared definition IDs. `src/extension.ts` registers it on every `session_start`.

## Runtime wiring

- `parse-v2-command.ts` parses the full `/loop` grammar (see README for the surface) into the dispatch union; `interval`/`delay` reuse `src/parse-duration.ts`. Creation `at` expressions reuse `src/parse-at-time.ts` and require the `--` prompt separator. `defer` takes one active ID followed by the entire duration/time expression, with no prompt separator. `delete` derives scope from the ID prefix and accepts `--force` anywhere in the token list.
- `due-poller.ts` arms one timer at the nearest active `nextRunAt`, chunks waits beyond `MAX_TIMEOUT` (~24.8 days), runs `core.runDue(deliver)` on fire, and re-arms. Non-`executed` outcomes (failed/locked/unavailable/not-due-due-to-race) arm the next timer no sooner than 60s later to avoid hot-looping. Handles are unref'd unless `PI_SCHEDULED_WAKEUP_RUNNER=1`. `extension.ts` calls `reschedule()` after every mutating command and tool action.
- `register-v2-tool.ts` converts exactly one of `delay`/`at`/`interval` strings into a `TaskSchedule` before dispatching to `AiSessionActions`; `scope` and `force` are absent from the schema and rejected at runtime if supplied.
- `loop-command-handler.ts` implements `run <id>` as immediate delivery without progress advancement (a registration requires a resolvable definition), `stop all` as sequential `cancelActive` over the current active set, and `defer <id> <duration|time...>` through the user facade. Successful defer notifies the new time and re-arms the poller; rejected defer reports the reason without mutation.
- `defer-active-task.ts` implements the defer contract through the existing `advance-task`/`advance-registration` snapshot actions. The action names do not imply a run-count increment; defer replaces only `nextRunAt`.

## Correctness boundaries

Definition/index mutation is atomic per scope catalog, but external Pi delivery and session entry append cannot be one transaction. Locks prevent healthy same-session overlap. Force invalidates future resolution immediately but cannot revoke a delivery already in progress.
