# Round 1 Audit: Task Actionability and Boulder Integration

## Finding 1 — Boulder treats blocked pending tasks as active work

**Violated invariant:** Boulder active work must equal `in_progress ∪ ready`, where `ready = pending ∧ unblocked`; blocked pending tasks alone must not trigger continuation.

**References:**
- `tools/task.ts:getTaskState` computes `pendingCount` from every task whose status is `"pending"` or `"in_progress"`.
- `tools/task.ts:getTaskState` separately computes `readyTasks` using `status === "pending" && isUnblocked(t, tasks)`, but Boulder does not consume it.
- `hooks/boulder.ts:registerBoulder` defines its local `TaskState` as `{ tasks; pendingCount }`, with no ready/unblocked field.
- `hooks/boulder.ts` `agent_end` path uses `pendingCount === 0` as the no-work gate.
- `hooks/boulder.ts` countdown `fire` re-fetches state and again uses only `fresh.pendingCount === 0` before restart.
- `hooks/boulder.ts:buildRestartMessage` lists tasks filtered only by `status === "pending" || status === "in_progress"`.

**Concrete counterexample path:**
1. Create two tasks: `#1` and `#2`.
2. Call `task.update_deps` so `#2.blockedBy = [1]`; leave `#1` either `in_progress` or not yet done, and leave `#2.status = "pending"`.
3. End an agent turn after no progress on `#2`, or after `#1` is no longer actionable in the current turn while `#2` remains blocked.
4. `getTaskState()` returns `pendingCount > 0` because `#2.status === "pending"`, even though `#2` is not ready.
5. Boulder `agent_end` does not return at its no-work check; after countdown, `fire` rechecks the same status-only `pendingCount` and sends a restart message containing blocked `#2`.

**Runtime impact:** A session with only blocked pending tasks can continue auto-restarting. The injected restart asks the agent to continue work that cannot legally start because `executeStart` rejects blocked tasks through `isUnblocked`. This produces repeated no-op continuations, apparent stop-hook instability, token burn, and possible runaway continuation until another suppression path intervenes.

**Severity:** High.

## Finding 2 — Task prompt injection contradicts the actionable-work invariant

**Violated postcondition:** Prompt state exposed to the agent after `before_agent_start` must describe remaining work using the same actionable predicate as Boulder: `in_progress ∪ ready pending`; blocked pending tasks must not be represented as work that forces continuation.

**References:**
- `tools/task.ts:buildActionableTaskList` correctly builds an actionable list from `in_progress` plus `pending && isUnblocked(t, allTasks)`.
- `tools/task.ts` `before_agent_start` computes `active` as every task with status `"pending"` or `"in_progress"`.
- `tools/task.ts` `before_agent_start` injects text saying pending/in-progress tasks must be completed or expired before stopping and that the loop restarts if any tasks remain `pending/in_progress`.
- `tools/task.ts` tool description repeats that the loop restarts automatically if any tasks remain pending/in_progress.

**Concrete counterexample path:**
1. Task `#2` is `pending` and blocked by unfinished task `#1`.
2. A new agent turn begins and `before_agent_start` runs.
3. The status-only `active` filter includes blocked `#2`.
4. The injected prompt says all pending/in-progress tasks must be completed or expired and warns that the loop restarts if any remain pending/in_progress, while `buildActionableTaskList` excludes `#2`.

**Runtime impact:** The agent receives inconsistent contract text: the actionable list says blocked `#2` is not ready, but the active-task section says `#2` must be completed/expired before stopping. This can cause agents to try illegal `start` actions, prematurely expire blocked work to stop the loop, or leave the task system in a state where Boulder keeps restarting for non-actionable work.

**Severity:** Medium.

## Finding 3 — `start` can resurrect terminal tasks

**Violated precondition:** `task.start(id)` may only transition a `pending` task that is unblocked into `in_progress`; terminal `done` or `expired` tasks must remain terminal.

**References:**
- `tools/task-actions.ts:executeStart` validates the ID, verifies the task exists, and checks `isUnblocked(task, tasks)`.
- `tools/task-actions.ts:executeStart` then assigns `task.status = "in_progress"` without checking `task.status === "pending"`.
- `tools/task-actions.ts:executeDoneOrExpire` can set a task to `"done"` or `"expired"`.
- `tools/task-helpers.ts:isUnblocked` returns true for tasks with no blockers, including terminal tasks with empty `blockedBy`.

**Concrete counterexample path:**
1. Create task `#1`; it has `blockedBy = []`.
2. Call `task.done` on `#1`; `executeDoneOrExpire` sets `#1.status = "done"`.
3. Later call `task.start` on `#1`.
4. `executeStart` finds the task and `isUnblocked(#1, tasks)` returns true because there are no blockers.
5. `executeStart` sets `#1.status = "in_progress"`, making completed work active again.

**Runtime impact:** Completed or expired tasks can re-enter active work. Because `getTaskState().pendingCount` includes `in_progress`, Boulder can restart on work that should have been terminal, and dependencies previously unblocked by `done`/`expired` completion can become semantically inconsistent after resurrection.

**Severity:** High.

## Finding 4 — Widget actionability gate is correct, but its active count is status-only

**Violated invariant:** User-visible active-task counts must use the same active-work predicate as task/Boulder actionability: `in_progress ∪ ready pending`.

**References:**
- `index.ts` task widget `hasActive` correctly uses `status === "in_progress" || (status === "pending" && isUnblocked(task, tasks))`.
- `index.ts` task widget header count computes `active` from every task whose status is `"pending"` or `"in_progress"`.
- `tools/task-helpers.ts:statusTag` distinguishes blocked pending tasks from ready pending tasks.

**Concrete counterexample path:**
1. Task `#2` is `pending` and blocked by unfinished `#1`; no task is `in_progress` and no pending task is unblocked.
2. The widget update callback computes `hasActive === false` and follows the no-active path.
3. In a mixed case with one actionable task plus one blocked pending task, the widget remains visible and its header active count includes both the actionable task and the blocked task.

**Runtime impact:** The widget can overreport active work by counting blocked pending tasks as active. This does not itself trigger Boulder because `hasActive` is correct, but it gives users a misleading actionability signal while debugging stop-hook behavior.

**Severity:** Low.
