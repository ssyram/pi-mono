# Scheduled Wakeup Detailed Design

## Scope

Implement a Pi extension package at `my-plugins/scheduled-wakeup/` with `/loop`, an AI-callable `scheduled_wakeup` tool, and a persisted in-process scheduler shared by both entrypoints.

## Existing reuse

- Reuse Pi `ExtensionAPI`, `ExtensionContext`, and `sendUserMessage`.
- Reuse Node `fs`, `path`, and `crypto.randomUUID`.
- Follow local timer cleanup patterns from `my-plugins/recap/extension.ts`.

## Error handling

- Invalid command input returns a concise UI notification and does not mutate state.
- Corrupt persisted JSON is ignored by loading an empty schedule; the next successful mutation overwrites it.
- Failed writes are surfaced through `ctx.ui.notify(..., "error")` when UI exists and thrown to the command caller. Command mutations persist the next snapshot before changing in-memory jobs or timers, so failed writes do not leave command state half-mutated.

## Function-level plan

### `parseDuration(value: string): number | undefined`

- Requires: `value` is a raw command token.
- Ensures: returns milliseconds for `<positive integer><s|m|h|d>` or `undefined` when invalid.
- Correctness: a single anchored regexp rejects partial tokens; unit switch multiplies by fixed constants.

### `parseAtTime(value: string, now?: Date): number | undefined`

- Requires: `value` is an absolute one-shot time expression.
- Ensures: returns a future epoch millisecond timestamp or `undefined` when invalid/past.
- Supported forms: ISO/`Date.parse` timestamps, `12am tomorrow`, `09:30 tomorrow +08:00`, `00:00 UTC`, local time when no zone is present.
- Correctness: clock parser separates absolute `at` from relative `delay/interval`; numeric timezone offsets are explicit and timezone abbreviations are rejected as ambiguous.

### `parseLoopCommand(args: string): LoopCommand`

- Requires: raw slash command argument string.
- Ensures: returns one of `help`, `list`, `stop`, `run`, `create`, or `error`.
- Branches: empty/help, list, stop, run, once, recurring.
- Correctness: each mutating branch validates required id/duration/prompt before returning a typed action.

### `JobStore.load(): ScheduledJob[]`

- Requires: store path is derived from cwd.
- Ensures: returns only structurally valid jobs.
- Correctness: JSON parsing is boundary input validation; invalid entries are filtered before the scheduler sees them.

### `JobStore.save(jobs: ScheduledJob[]): void`

- Requires: jobs already satisfy `ScheduledJob` invariants.
- Ensures: target JSON file is replaced with a formatted snapshot.
- Correctness: write temp file then rename, so readers see either old or new complete JSON.

### `Scheduler.start(ctx: ExtensionContext): void`

- Requires: called after `session_start`.
- Ensures: one timeout is active per job; handles are unref'd except in explicit runner mode.
- Correctness: clears existing handles before reloading, preventing duplicate timers.

### `Scheduler.create(delayMs, prompt, recurring): ScheduledJob`

- Requires: `delayMs > 0`, non-empty prompt.
- Ensures: persists and schedules the new job.
- Correctness: generates unique id, computes `nextRunAt = now + delayMs`, persists the next job list before mutating in-memory state, then schedules.

### `Scheduler.fire(jobId: string): void`

- Requires: invoked by a timeout for a known job id.
- Ensures: due prompt is delivered once for that firing; recurring jobs are rescheduled, one-shot jobs removed.
- Branches: missing job, idle delivery, busy follow-up delivery, recurring reschedule, one-shot deletion.
- Correctness: the job is looked up at fire time, so stopped jobs do not deliver stale timeout payloads.

### `Scheduler.stop(target: string): number`

- Requires: target is an id or `all`.
- Ensures: matching timers are cleared and matching jobs are removed.
- Correctness: persists the next job list before clearing timers or replacing in-memory state.

### `registerScheduledWakeupTool(pi, getScheduler): void`

- Requires: `getScheduler(ctx)` returns a scheduler bound to `ctx.cwd` and the current process lifecycle mode.
- Ensures: registers `scheduled_wakeup` with actions `add`, `list`, `stop`, and `run`.
- Correctness: tool actions call the same `Scheduler` methods as `/loop`; `add` requires exactly one of `delay`, `at`, or `interval`, with `at` converted to a one-shot delay at execution time. In ordinary short-process invocations the scheduler is loaded with inactive timers, so tool queue management does not keep `pi -p` alive.

## Checklist

- [x] Branches specified for command parsing and firing.
- [x] Exits specified for invalid input and missing jobs.
- [x] External calls identified: Pi send APIs and filesystem writes.
- [x] Timers have termination/cleanup through clearTimeout and `.unref?.()` outside explicit runner mode.
- [x] Assumption chain documented in architecture.
