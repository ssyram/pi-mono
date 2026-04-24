# Round 1 Candidate Findings

Spec source: user-provided decisions on top of /hoare-design-style reverse-engineered source spec.

## Runtime candidates requiring independent confirmation

### R1-C1: Persistent `/omp-stop` mechanism violates removed-command spec

- Candidate source reports: PSM-01.
- Files/functions: `my-plugins/oh-my-pi-v2/index.ts`, `hooks/boulder.ts`.
- Claim: `/omp-stop` is still registered and wired through `continuationStopped` into Boulder, creating a persistent command-level stop mechanism even though the Round 1 spec says `/omp-stop` should be removed.
- Runtime impact: user can invoke `/omp-stop`; later Boulder checks suppress auto-continuation until the next agent start.
- Proposed class: Non-Decisional.

### R1-C2: Boulder treats blocked pending tasks as active work

- Candidate source reports: PSM-02, Task Finding 1, Resource Finding 1.
- Files/functions: `tools/task.ts:getTaskState`, `hooks/boulder.ts:agent_end`, `hooks/boulder.ts:buildRestartMessage`.
- Claim: Boulder gates restart on `pendingCount`, which counts all pending tasks, including blocked pending tasks. Round 1 spec says active work is `in_progress + ready` where ready is unblocked pending.
- Runtime impact: if only blocked pending tasks remain, Boulder can inject restart messages even though no task is actionable.
- Proposed class: Non-Decisional.

### R1-C3: Task prompt/widget counts contradict actionable-work spec

- Candidate source reports: Task Findings 2 and 4.
- Files/functions: `tools/task.ts:before_agent_start`, `index.ts` task widget callback.
- Claim: prompt/widget wording/counts can tell the agent all pending/in-progress tasks remain active even when pending tasks are blocked and unactionable.
- Runtime impact: misleading restart/stop instructions and UI counts; may be symptom of R1-C2.
- Proposed class: Candidate but likely root-caused by R1-C2/actionable count API.

### R1-C4: `task.start` can resurrect terminal tasks

- Candidate source reports: Task Finding 3.
- Files/functions: `tools/task-actions.ts:executeStart`.
- Claim: `start` only checks existence and unblocked dependencies, not current status. A `done` or `expired` task with satisfied dependencies can become `in_progress` again.
- Runtime impact: completed/expired work can become active again via normal tool call.
- Proposed class: Non-Decisional.

### R1-C5: Boulder hook failures are swallowed without observability or disablement

- Candidate source reports: PSM-03, Resource Finding 2, Error Finding 1, External R1-EXT-002.
- Files/functions: `hooks/boulder.ts:agent_end` outer catch.
- Claim: Boulder catches all hook exceptions locally and discards them, preventing host hook error reporting and providing no Boulder diagnostic, warning, counter, or disable path.
- Runtime impact: repeated hook failures can make continuation fail silently and look intermittent/unstable.
- Proposed class: Non-Decisional under user decision 4.

### R1-C6: Repeated restart injection failures do not disable Boulder

- Candidate source reports: PSM-04, Error Finding 2.
- Files/functions: `hooks/boulder.ts:sendRestart`.
- Claim: `sendRestart` increments `injectionFailures` and may warn at threshold, but Boulder remains enabled and keeps scheduling future restarts.
- Runtime impact: persistent injection failure can cause repeated countdown/retry churn instead of fail-closed disablement.
- Proposed class: Non-Decisional under user decision 4.

### R1-C7: Async `sendUserMessage` failures are not observable to Boulder failure accounting

- Candidate source reports: Resource Finding 3, External R1-EXT-001.
- Files/functions: `hooks/boulder.ts:sendRestart`, `hooks/boulder.ts:handleStagnation`, pi extension runtime binding.
- Claim: extension-facing `sendUserMessage` returns void; async prompt failures are emitted by host later, so Boulder synchronous try/catch cannot count them and resets/maintains success state incorrectly.
- Runtime impact: continuation delivery can fail while Boulder believes it succeeded; repeated-failure disable logic does not trigger for async failures.
- Proposed class: Confirm; may become a Decisional/host-API limitation depending on feasible fix.

### R1-C8: Stagnation stop-message failure is unobservable and resets stagnation count

- Candidate source reports: Error Finding 3.
- Files/functions: `hooks/boulder.ts:handleStagnation`.
- Claim: if sending the stagnation stop message fails, only `injectionFailures++` changes and `stagnationCount` resets anyway, so the stuck state may be hidden.
- Runtime impact: stuck-loop protection may silently fail and not retry correctly.
- Proposed class: Non-Decisional if confirmed; likely related to R1-C7/C6.

### R1-C9: Task-change callback failures either propagate from task hooks/tools or are silently suppressed by current callback

- Candidate source reports: Error Finding 4.
- Files/functions: `tools/task.ts:notifyChange`, `index.ts` callback registered by `setOnTaskChange`.
- Claim: task callback invocation has no central non-throwing observable boundary. Current callback catches UI failures but suppresses them silently; a different callback could throw through task operations.
- Runtime impact: task mutation/reload can fail or hide UI update failure.
- Proposed class: Confirm; root cause may be missing observable callback boundary.

### R1-C10: Task persistence failure after in-memory mutation causes durable state drift

- Candidate source reports: Error Finding 5.
- Files/functions: `tools/task.ts` mutating action execute path, `persistState`.
- Claim: mutating actions update memory and notify before `appendEntry`; if persistence fails, current memory/UI state gets ahead of durable session state.
- Runtime impact: session reload/restart can resurrect stale task state or lose completed status.
- Proposed class: Confirm; may require checking tool error semantics.

### R1-C11: Reload failure clears task state before failing

- Candidate source reports: Error Finding 6.
- Files/functions: `tools/task.ts:reloadState`.
- Claim: reload initializes/clears state before reading entries; if session read fails, in-memory tasks may be empty despite persisted tasks existing.
- Runtime impact: Boulder may observe no active tasks and stop continuation incorrectly.
- Proposed class: Non-Decisional if confirmed.

### R1-C12: `activeCountdown` retains completed handle after natural finish

- Candidate source reports: Resource Finding 4.
- Files/functions: `hooks/boulder.ts`, `hooks/boulder-countdown.ts`.
- Claim: countdown completion cleans timer/input but Boulder module variable still references completed handle until later reset/agent_end.
- Runtime impact: stale state only; likely low priority.
- Proposed class: Confirm as hardening or reject if not runtime-observable.
