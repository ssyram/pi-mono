# SCCO Round 001 Resolution

> **Superseded by Loop 2.0** — records the removed Loop 1.x review; kept as history. Current audit trail: [`docs/ver-2.0/audit/`](../../ver-2.0/audit/).

## Effective findings

- High: missing lifecycle/scheduler/persistence tests for the `pi -p`/subagent lifecycle and timer semantics.
- Medium: persistence failures could leave command mutations half-applied in memory and did not notify UI before throwing.

## Fixes applied

- Added explicit short-process semantics:
  - Ordinary `-p`, `--print`, `--mode=json`, and `--mode json` invocations skip scheduler startup.
  - `PI_SCHEDULED_WAKEUP_RUNNER=1` opts into headless runner behavior for short-process invocations.
  - Runner timers remain referenced intentionally; normal timers stay `.unref?.()`'d.
- Added active-instance gates so stale reload handlers are inert.
- Changed command mutations to persist the next job snapshot before changing in-memory jobs or timers.
- Added persistence error notification in `Scheduler.persist(...)` before rethrowing.
- Added `npm test --prefix my-plugins/scheduled-wakeup` and documented it.
- Added tests for:
  - default `pi -p` skip behavior;
  - explicit `PI_SCHEDULED_WAKEUP_RUNNER=1` runner behavior;
  - normal timer `.unref()` vs runner keep-alive timers;
  - create persistence failure rollback and UI notification;
  - `/loop run` delivery failure handling;
  - busy-context follow-up delivery;
  - parser and duration behavior.

## Verification

- `npx tsc -p my-plugins/scheduled-wakeup/tsconfig.json` passed.
- `npm test --prefix my-plugins/scheduled-wakeup` passed: 12 tests, 4 suites.
- `npm run check` passed.
- Source line limits checked with `wc -l`: all plugin source files remain below 200 LOC.

## Residual risks

- Runtime integration with a real Pi process is covered by source-level and unit tests, not an end-to-end `pi -p` subprocess smoke test.
- Persistence is still single-writer per cwd; concurrent Pi processes writing the same `.pi/scheduled-wakeup/jobs.json` are outside the current design boundary.
