# Scheduled Wakeup Design Review Resolution

## Source

Independent background reviewer output: `.pi-subagents/artifacts/outputs/325719a3-09bf-455d-a877-d8eb98a369fd/my-plugins/scheduled-wakeup/docs/audit/design-review.md`.

## Findings resolved

- Overdue recurring policy: recurring jobs fire at most once on resume/startup, then set `nextRunAt = now + intervalMs`. They do not replay every missed interval.
- Native timer maximum: scheduler chunks long delays using `MAX_TIMEOUT_MS = 2_147_483_647`; when the chunk expires early, it reschedules instead of delivering before `nextRunAt`.
- Reload ownership: the extension stores only a disposable instance on `globalThis`; startup calls the previous `dispose()`, and `dispose()` clears timers before removing itself only if it still owns the global slot.
- Duration overflow: parser rejects durations whose computed milliseconds are not a safe integer.
- `pi -p` / JSON subagent safety: scheduler startup is skipped in `print` and `json` mode unless `PI_SCHEDULED_WAKEUP_RUNNER=1`, so ordinary short-lived processes exit while explicit runner processes intentionally stay alive.

## Accepted boundaries

- This plugin is an in-process scheduler, not an OS daemon.
- Corrupt JSON is treated as no jobs; the next mutation writes a fresh valid snapshot.
- `/loop run <id>` manually injects the prompt and increments `runCount` without changing the schedule.
