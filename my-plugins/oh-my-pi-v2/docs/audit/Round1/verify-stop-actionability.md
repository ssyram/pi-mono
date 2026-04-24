# Round 1 Verification: `/omp-stop` Removal and Actionable Boulder Semantics

## Scope

Inspected from scratch, per request:

- `my-plugins/oh-my-pi-v2/index.ts`
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts`
- `my-plugins/oh-my-pi-v2/hooks/boulder-countdown.ts`
- `my-plugins/oh-my-pi-v2/tools/task.ts`
- `my-plugins/oh-my-pi-v2/tools/task-actions.ts`
- Allowed context only: `my-plugins/oh-my-pi-v2/docs/audit/Round1/round-context.md`

Used `rg` across the inspected source files for `/omp-stop`, stop-callback/state terms, Esc/cancel paths, `actionableCount`, `pendingCount`, `readyTasks`, and active-task predicates.

## Summary

| Fix point | Result |
|---|---|
| `/omp-stop` command removed | PASS |
| Stop callback/state removed from Boulder wiring | PASS |
| Esc remains one-shot countdown cancellation only | PASS |
| Boulder restart/stagnation/countdown gates use `actionableCount` | PASS |
| Blocked-only pending tasks do not restart Boulder | PASS |
| Task prompt active work uses actionable work | PASS |
| Task widget active count uses actionable work | PASS |

## Evidence

### 1. `/omp-stop` command removed — PASS

Evidence:

- `index.ts:32-36` imports only `registerStartWork`, `registerConsult`, `registerReviewPlan`, and `ensureSubagentLinks`; there is no stop-command import.
- `index.ts:138-141` registers only:
  - `registerStartWork(...)`
  - `registerConsult(...)`
  - `registerReviewPlan(...)`
- `rg` over the five inspected source files produced no `/omp-stop` hits.

Conclusion: the `/omp-stop` command is not imported, registered, or referenced in the inspected source.

### 2. Stop callback/state removed from Boulder wiring — PASS

Evidence:

- `index.ts:123-128` calls `registerBoulder(pi, getTaskState)` with no stop callback argument.
- `hooks/boulder.ts:73-77` defines `registerBoulder(pi, getTaskState, hasRunningTasks?)`; there is no stop callback parameter.
- `hooks/boulder.ts:48-57` module state contains `activeCountdown`, `lastRunAt`, stagnation fields, `injectionFailures`, and `disabled`; no persistent stop flag/state is present.
- `rg` over the inspected files found no hits for `stopCallback`, `onStop`, `shouldStop`, or `stop state`.

Conclusion: the former command-level stop callback/state path is removed from Boulder registration and inspected module state.

### 3. Esc remains one-shot countdown cancellation only — PASS

Evidence:

- `hooks/boulder-countdown.ts:1-7` describes Esc as cancelling the pending restart during the countdown.
- `hooks/boulder-countdown.ts:34-41` keeps countdown state local to `startCountdown`: `remaining` and `cancelled`, and displays `press Esc to cancel`.
- `hooks/boulder-countdown.ts:44-49` `cleanup()` sets local `cancelled = true`, clears the interval/status, and unsubscribes the input handler.
- `hooks/boulder-countdown.ts:63-70` Esc handling calls `cleanup()`, notifies `Task restart cancelled.`, consumes input, and does not call `onFinish()`.
- `hooks/boulder-countdown.ts:73-77` the returned handle exposes only `cancel()` for that countdown instance.
- `hooks/boulder.ts:90-92` cancels any active countdown at the start of the next `agent_end`, so the cancellation is tied to the current countdown lifecycle rather than a persistent stop state.

Conclusion: Esc cancels the current countdown/restart attempt only. No persistent Esc-driven Boulder stop state is present in the inspected source.

### 4. Boulder restart/stagnation/countdown gates use `actionableCount` — PASS

Evidence:

- `hooks/boulder.ts:29-34` `TaskState` includes `actionableCount` and `readyTasks`.
- `hooks/boulder.ts:94-100` `agent_end` reads `{ tasks, actionableCount, readyTasks }` and returns when `actionableCount === 0`.
- `hooks/boulder.ts:124-143` stagnation detection derives IDs from `getActionableTasks(tasks, readyTasks)` and stores/compares `actionableCount`.
- `hooks/boulder.ts:146-172` restart message/countdown paths use `actionableCount`; countdown fire re-fetches state and returns when `fresh.actionableCount === 0`.
- `hooks/boulder.ts:181-186` defines actionable tasks as `in_progress` tasks plus `readyTasks`.
- `hooks/boulder.ts:232-253` restart messages list `getActionableTasks(tasks, readyTasks)`, not all pending tasks.

Conclusion: Boulder zero-work, stagnation, restart-message, visible-countdown, and countdown-fire gates are based on actionable work.

### 5. Blocked-only pending tasks do not restart Boulder — PASS

Evidence:

- `tools/task.ts:167-177` computes:
  - `readyTasks = tasks.filter((t) => t.status === "pending" && isUnblocked(t, tasks))`
  - `inProgressCount = tasks.filter((t) => t.status === "in_progress").length`
  - `actionableCount: inProgressCount + readyTasks.length`
- `hooks/boulder.ts:94-100` returns without restart when `actionableCount === 0`.
- `hooks/boulder.ts:181-186` actionable tasks are only `in_progress` plus `readyTasks`.
- `tools/task-actions.ts:50-65` prevents starting a blocked pending task: `executeStart` requires `status === "pending"`, then rejects when `!isUnblocked(task, tasks)`, and only then sets `status = "in_progress"`.

Conclusion: if only blocked pending tasks remain, `readyTasks.length` is `0`, `inProgressCount` is `0`, `actionableCount` is `0`, and Boulder does not restart.

### 6. Task prompt active counts use actionable work — PASS

Evidence:

- `tools/task.ts:35-49` `buildActionableTaskList()` includes only `in_progress` tasks and unblocked `pending` tasks, tagged as `[in_progress]` or `[ready]`.
- `tools/task.ts:97-117` `before_agent_start` injects only tasks where `status === "in_progress"` or `status === "pending" && isUnblocked(...)`; prompt wording says `currently actionable` and restart occurs if `actionable tasks remain`.
- `tools/task.ts:121-130` task tool description says blocked tasks cannot start until blockers are done/expired and the loop restarts if tasks remain `in_progress or ready`.

Conclusion: the task prompt exposes active work as `in_progress + ready`, not all pending tasks.

### 7. Task widget active counts use actionable work — PASS

Evidence:

- `index.ts:65-67` widget `hasActive` is true only for `in_progress` or `pending && isUnblocked(t, tasks)`.
- `index.ts:68-77` when no actionable work remains, the widget clears and notifies completion; remaining pending tasks are counted as blocked.
- `index.ts:89-91` widget active count uses the same actionable predicate and renders `Tasks (${active} active, ...)`.
- `index.ts:101-103` blocked pending tasks are shown with the blocked-path icon when `statusTag(...)` returns `[blocked]`.

Conclusion: the task widget active state/count uses actionable work and excludes blocked-only pending tasks.

## Notes / Non-blocking Observations

- `CONFIRM_STOP_TAG` remains in `tools/task.ts:19`, `tools/task.ts:111-112`, and `hooks/boulder.ts:232-253`, and `hooks/boulder.ts:102-106` suppresses restart when the tag is present. This is not the removed `/omp-stop` command or stop-callback state; it is a message-tag suppression path still present in the inspected source.
- `pendingCount` remains in `TaskState` and still counts all pending-or-in-progress tasks in `tools/task.ts:171-174`, including blocked pending tasks. The inspected Boulder restart/stagnation/countdown gates use `actionableCount` instead.
- `hooks/boulder.ts:207-217` names a stagnation function parameter `pendingCount` and message text says `tasks still pending`, but the caller at `hooks/boulder.ts:142` passes `actionableCount`.
