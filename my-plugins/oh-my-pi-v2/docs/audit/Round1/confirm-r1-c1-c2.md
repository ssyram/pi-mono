# Round 1 fresh-eyes confirmation: R1-C1 / R1-C2

Scope: `my-plugins/oh-my-pi-v2` local interactive pi extension deployment, per `round-context.md`. I read only the round context and source needed to verify actual reachable behavior.

## R1-C1 — `/omp-stop` remains registered and wired into Boulder

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. Plugin entrypoint `index.ts` declares persistent stop state:
   - `let continuationStopped = false`
2. During normal plugin initialization, when Boulder is enabled, `index.ts` calls:
   - `registerBoulder(pi, getTaskState, () => continuationStopped)`
3. The same entrypoint registers a reachable slash command:
   - `pi.registerCommand("omp-stop", { ... })`
4. The `/omp-stop` handler sets:
   - `continuationStopped = true`
5. Boulder receives that callback as `isStopped`. In `hooks/boulder.ts`, Boulder checks `isStopped?.()` in the `agent_end` hook before scheduling continuation work and checks it again in the countdown `fire` callback before sending the restart message.
6. Therefore a local interactive user can invoke `/omp-stop`, mutate the stop flag in the plugin process, and cause Boulder to suppress auto-continuation until the flag is reset by later `before_agent_start` handling.

This directly conflicts with the Round 1 context requirement that `/omp-stop` should be removed and that no persistent command-level Boulder stop mechanism should exist. The reachable deployment context matches: this is a local interactive pi extension command registered through the plugin entrypoint.

## R1-C2 — Boulder treats blocked pending tasks as active work

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. The task model supports blocked pending tasks: `Task` includes `blockedBy`, and `isUnblocked(task, allTasks)` returns false while blockers are unfinished.
2. The task action path enforces that distinction: `executeStart()` refuses to start a blocked task when `!isUnblocked(task, tasks)`, so a blocked task can remain `status: "pending"` and not be actionable.
3. The task state handle returned by `registerTaskTool()` exposes both:
   - `readyTasks`: `status === "pending" && isUnblocked(t, tasks)`
   - `pendingCount`: every task where `status === "pending" || status === "in_progress"`
4. Boulder is wired to `getTaskState` from that handle through `registerBoulder(pi, getTaskState, ...)`.
5. In `hooks/boulder.ts`, Boulder uses `pendingCount` as the no-work gate:
   - in `agent_end`, it returns only when `state.pendingCount === 0`
   - after countdown, it re-fetches state and returns only when `fresh.pendingCount === 0`
6. Boulder also builds stagnation/restart task sets using only `status === "pending" || status === "in_progress"`, with no `isUnblocked` or `readyTasks` filter.

A reachable local sequence is: create tasks A and B, make B blocked by A, complete/expire A is not required for B to be ready; while A remains unfinished, B stays `pending` but blocked. `getTaskState().pendingCount` still counts B, so Boulder sees remaining work and can schedule/send an automatic continuation even though the Round 1 active-work contract is `in_progress + ready`, where ready means unblocked `pending` only.

This directly conflicts with the Round 1 context requirement that blocked pending tasks alone should not trigger automatic continuation.
