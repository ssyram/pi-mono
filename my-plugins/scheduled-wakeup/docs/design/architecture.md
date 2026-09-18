# Scheduled Wakeup Architecture

## Goals

- G1: Allow a user or AI agent to schedule one-shot and recurring Pi prompts from slash commands or a tool.
- G2: Preserve schedules across extension reload and Pi process restart while the project directory is unchanged.
- G3: Avoid leaked timers, duplicate timers, and busy-agent interruption.
- G4: Keep the implementation small and isolated under `my-plugins/scheduled-wakeup/`.

## Core data structure

`ScheduledJob`

- `id: string` — short unique identifier shown to the user.
- `prompt: string` — user message to inject when due.
- `intervalMs: number | undefined` — present for recurring jobs.
- `nextRunAt: number` — epoch milliseconds for the next due time.
- `createdAt: number` — epoch milliseconds for audit/display.
- `runCount: number` — number of successful due firings attempted by the scheduler.

Type invariants:

- `id` is unique within the persisted job list.
- `prompt.trim().length > 0`.
- `nextRunAt > 0`.
- `intervalMs === undefined || intervalMs > 0`.

## Modules

- `extension.ts`: registers lifecycle hooks, `/loop`, and the `scheduled_wakeup` tool; owns the global reload-safe instance key.
- `scheduler.ts`: owns active timeout handles, starts/stops jobs, and delivers due prompts.
- `job-store.ts`: loads and saves `ScheduledJob[]` to `.pi/scheduled-wakeup/jobs.json` with atomic replace.
- `parse-loop-command.ts`: converts command text into typed actions.
- `parse-duration.ts`: parses relative `10s`, `5m`, `2h`, `1d` durations.
- `parse-at-time.ts`: parses one-shot absolute clock times such as `12am tomorrow`, `09:30 +08:00`, and ISO timestamps.
- `format-duration.ts` and `format-job.ts`: display-only formatting.
- `register-scheduled-wakeup-tool.ts`: exposes the shared scheduler as the AI-callable `scheduled_wakeup` tool.
- `types.ts`: shared type definitions for the plugin.

## Flow

1. On extension factory execution, clean any previous global instance from reload.
2. Register handlers only; do not start timers at module load time.
3. On `session_start`, do nothing in `print` or `json` mode unless `PI_SCHEDULED_WAKEUP_RUNNER=1`, so ordinary short-lived `pi -p` and JSON subagent processes can exit without scheduled wakeups changing their lifecycle.
4. In `tui`, `rpc`, and explicit runner mode, create a scheduler bound to the current `ctx.cwd`, load persisted jobs, and schedule a timeout for each job.
5. On `/loop ...`, parse the command and mutate the store through the scheduler.
6. On `scheduled_wakeup` tool calls, validate action-specific parameters and mutate the same scheduler/store as `/loop`; `delay`/`interval` are relative duration inputs, while `at` is an absolute one-shot clock input.
7. In ordinary short-process invocations, tool calls can manage the persisted queue without activating timers; explicit runner mode activates timers.
8. When a timeout fires, inject the prompt with `pi.sendUserMessage()` if idle, otherwise with `{ deliverAs: "followUp" }`.
9. For recurring jobs, update `nextRunAt = now + intervalMs` and reschedule. Missed intervals are not replayed; an overdue recurring job fires once on resume/startup.
10. For delays larger than Node's native timeout limit, schedule one maximum-length timeout chunk and re-check `nextRunAt` when it fires.
11. Timers are unref'd in normal modes; in explicit runner mode they stay referenced so the process intentionally remains alive.
12. For one-shot jobs, remove the job after delivery.
13. On `session_shutdown`, clear every timeout and forget the active scheduler.

## Correctness argument

- G1 follows from command parsing, tool parameter validation, and scheduler delivery through `sendUserMessage`.
- G2 follows from saving each mutation and loading jobs on `session_start`; missed due jobs run after startup because overdue `nextRunAt` schedules with zero delay.
- G3 follows from reload cleanup, inactive stale-handler gates, default `print`/`json` startup skip, explicit runner opt-in for referenced timers, `session_shutdown` clearing, `.unref?.()` on normal-mode timeouts, safe long-delay chunking, non-replay overdue recurring policy, and follow-up delivery while busy.
- G4 follows from the package-local file layout and no official source modifications.

## Reload ownership

The extension keeps only a disposable instance record on `globalThis`. On reload, the new factory calls the previous instance's `dispose()` before registering a new instance. `dispose()` clears timers and removes the global record only when it still owns the slot.

## Known boundary

This extension is not a daemon. It cannot start a new Pi process at wall-clock time if no Pi process is running. It resumes and fires each overdue job once the next time Pi starts in the same cwd.
