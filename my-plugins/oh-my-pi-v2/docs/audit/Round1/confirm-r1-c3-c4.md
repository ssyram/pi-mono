# Round 1 confirmation: R1-C3 and R1-C4

Scope: independent source confirmation for `omp-v2`, using only `docs/audit/Round1/round-context.md` plus needed source files.

## R1-C3 — CONFIRMED — triggering

Claim: task prompt/widget active counts contradict the actionable-work spec for blocked pending tasks.

Verdict rationale: confirmed on the live runtime path. The Round 1 context defines Boulder active work as `in_progress + ready`, where ready means unblocked `pending`; blocked pending tasks alone should not trigger automatic continuation. Source implements that actionable definition in one place, but the prompt, widget/list counts, and Boulder continuation path use broader pending/in-progress counts that include blocked pending tasks.

Concrete runtime path:

- `tools/task.ts` defines `buildActionableTaskList()` as `in_progress` tasks plus `pending` tasks that pass `isUnblocked(...)`. This matches the spec-level `in_progress + ready` contract.
- The `before_agent_start` prompt hook in `tools/task.ts` separately builds `active` from every task whose status is `pending` or `in_progress`, then injects an `Active Tasks` section saying all pending/in-progress tasks must be completed or expired and restart will occur if tasks remain pending/in_progress. Blocked pending tasks are therefore included in the active prompt even though they are not actionable/ready.
- `tools/task.ts` exposes `getTaskState().pendingCount` as the count of tasks whose status is `pending` or `in_progress`, while `readyTasks` is separately restricted to unblocked pending tasks.
- `hooks/boulder.ts` consumes `getTaskState().pendingCount` in the `agent_end` hook: it returns only when `pendingCount === 0`, otherwise proceeds to stagnation/restart handling. The same path builds restart messages/countdowns from `pendingCount` and task lists filtered only by `pending` or `in_progress`, with no unblocked/ready filter.
- `tools/task-renderers.ts` renders the task list/widget header pending count from every `status === "pending"` task. It later labels blocked tasks via `statusTag(...)`, but the count itself still includes blocked pending tasks.
- `tools/task-helpers.ts` confirms the distinction: `isUnblocked(...)` treats only tasks with all blockers done/expired/missing as unblocked, and `statusTag(...)` renders blocked pending tasks as `[blocked]` instead of `[ready]`.

Impact under the specified deployment context: a session with only blocked pending tasks has zero actionable/ready pending work, but source-level prompt/widget/Boulder counts still treat those blocked pending tasks as active/pending. That can trigger Boulder continuation/restart messaging contrary to the Round 1 actionable-work contract.

## R1-C4 — CONFIRMED — triggering

Claim: `task.start` can move `done`/`expired` terminal tasks back to `in_progress`.

Verdict rationale: confirmed by the `task.start` action path. The implementation validates id, existence, and blocker satisfaction, but never rejects terminal prior statuses before overwriting the task status.

Concrete runtime path:

- `tools/task.ts` dispatches the `start` action to `executeStart(params.id, tasks, nextId)`.
- `tools/task-actions.ts` implements `executeStart(...)`. It checks that the id is valid, finds the task, and calls `isUnblocked(task, tasks)`.
- If those checks pass, `executeStart(...)` unconditionally assigns `task.status = "in_progress"` and clears `task.expireReason`.
- There is no guard requiring the prior status to be `pending`, and no rejection when the prior status is `done` or `expired`.
- `tools/task-helpers.ts` defines `done` and `expired` as valid task statuses and `isUnblocked(...)` only evaluates dependency satisfaction. For a terminal task with no active blockers, the unblocked check passes, so `task.start` rewrites that terminal status to `in_progress`. For an expired task, it also erases the expiration reason.

Impact under the specified deployment context: task state is session/disk-backed through custom session entries, so this transition can create persisted task-state drift by reviving a terminal task through a normal `task.start` call.
