# Round 1 audit — Error propagation and observability

Target: `my-plugins/oh-my-pi-v2` Boulder/task hooks  
Scope source inspected: `hooks/boulder.ts`, `hooks/boulder-countdown.ts`, `hooks/boulder-helpers.ts`, `tools/task.ts`, `tools/task-actions.ts`, `tools/task-renderers.ts`, `tools/task-helpers.ts`, `index.ts`

## Finding 1 — Boulder `agent_end` hook can fail silently

**Severity:** High

**Violated contract:**
- **Invariant:** Boulder hook failures must not throw into the host system, but they must be observable via diagnostics, log, or UI warning.
- **Postcondition:** If a Boulder hook callback catches a runtime failure, the catch path emits an observable diagnostic and/or increments a visible failure/disable path.

**Exact references:**
- `hooks/boulder.ts:77-168` — `agent_end` hook body is wrapped in `try`/`catch`.
- `hooks/boulder.ts:165-166` — catch block contains only `// Hooks must never throw` and emits no log, diagnostic, UI warning, or failure-state update.
- `hooks/boulder-countdown.ts:37-48` — `startCountdown()` calls `ctx.ui.setStatus(...)` and `unsubInput()` without local observability.
- `hooks/boulder-countdown.ts:64-68` — Esc handler calls `ctx.ui.notify(...)` without local observability.

**Concrete counterexample path:**
1. Host fires `agent_end` and Boulder enters `hooks/boulder.ts:77-164`.
2. `config.boulder.visibleCountdown` is true, so `startCountdown(...)` is called at `hooks/boulder.ts:160`.
3. Inside `startCountdown`, `updateStatus()` calls `ctx.ui.setStatus(...)` at `hooks/boulder-countdown.ts:37-40`.
4. The host UI API throws, for example because the UI object is unavailable or rejects the status update.
5. The exception propagates back into the outer `agent_end` catch at `hooks/boulder.ts:165-166`.
6. The catch suppresses the exception with no `ctx.ui.notify`, no `console.error`, no diagnostic entry, and no Boulder failure counter update.

**Runtime impact:**
Boulder auto-continuation silently fails to schedule or display the countdown. The user sees intermittent non-continuation with no warning or diagnostic trail. Because the failure is not counted, repeated occurrences do not drive Boulder toward a disabled state or any user-visible degradation mode.

## Finding 2 — Repeated restart injection failures notify but do not disable Boulder

**Severity:** Critical

**Violated contract:**
- **Invariant:** Repeated Boulder failures disable Boulder and notify the user.
- **Postcondition:** Once the repeated-failure threshold is reached, Boulder enters a disabled/stopped state that prevents further automatic continuation attempts until explicit re-enable.

**Exact references:**
- `hooks/boulder.ts:35` — `MAX_INJECTION_FAILURES = 5`.
- `hooks/boulder.ts:149-164` — countdown finish path calls `sendRestart(...)`.
- `hooks/boulder.ts:221-241` — `sendRestart()` catches `pi.sendUserMessage(...)` failure and increments `injectionFailures`.
- `hooks/boulder.ts:235-239` — threshold path only calls `ctx.ui.notify(...)`; no disabled flag or stopped state is set.
- `index.ts:127-132` — Boulder receives only `() => continuationStopped`; no callback is provided for Boulder to set this stop flag on repeated failures.

**Concrete counterexample path:**
1. A ready task exists and `agent_end` schedules a restart countdown at `hooks/boulder.ts:149-164`.
2. The countdown fires and `sendRestart(pi, ctx, msg)` runs.
3. `pi.sendUserMessage(msg, { deliverAs: "followUp" })` throws at `hooks/boulder.ts:228-230`, for example because the host rejects follow-up delivery.
4. The catch increments `injectionFailures` at `hooks/boulder.ts:233`.
5. Steps 1-4 repeat until `injectionFailures >= 5`.
6. The threshold branch at `hooks/boulder.ts:235-239` notifies `Boulder: gave up after 5 injection failures. Use /omp-continue to retry.`
7. No assignment disables Boulder in `sendRestart()`, and `index.ts:127-132` provides Boulder no setter for `continuationStopped`.
8. Future `agent_end` events can continue evaluating tasks and attempting restart injection.

**Runtime impact:**
The user may be warned once the threshold is reached, but Boulder remains eligible to keep scheduling automatic continuation attempts. In a persistent host-send failure, this can create repeated failed follow-up injections, repeated warnings, and unstable or noisy behavior instead of a clear disabled state.

## Finding 3 — Stagnation stop-message injection failures are unobservable and reset stagnation accounting

**Severity:** High

**Violated contract:**
- **Invariant:** Boulder hook failures must not throw into the host system, but they must be observable.
- **Invariant:** Repeated Boulder failures disable Boulder and notify the user.
- **Postcondition:** Failure to inject a Boulder control message is either visible immediately or contributes to a visible repeated-failure/disable path without hiding the triggering condition.

**Exact references:**
- `hooks/boulder.ts:132-135` — after three stagnant pending-count cycles, Boulder calls `handleStagnation(...)` and returns.
- `hooks/boulder.ts:173-195` — `handleStagnation()` sends the stuck/stop message through `pi.sendUserMessage(...)`.
- `hooks/boulder.ts:190-192` — catch block only increments `injectionFailures`.
- `hooks/boulder.ts:194` — `stagnationCount = 0` runs after the catch regardless of whether the message was delivered.

**Concrete counterexample path:**
1. Pending/in-progress task count remains unchanged for three `agent_end` cycles.
2. `stagnationCount >= 3` at `hooks/boulder.ts:132`, so `handleStagnation(pi, ctx, pendingCount)` runs.
3. `handleStagnation()` calls `pi.sendUserMessage(...)` at `hooks/boulder.ts:187-189` to ask the agent to stop because tasks appear stuck.
4. The host send API throws.
5. The catch at `hooks/boulder.ts:190-192` increments `injectionFailures`, but emits no UI warning, log, or diagnostic.
6. `stagnationCount = 0` runs at `hooks/boulder.ts:194` even though the stuck/stop message was not delivered.

**Runtime impact:**
The system detects a stuck Boulder/task condition but can fail to notify either the agent or the user. Resetting `stagnationCount` hides that the stagnation intervention failed, delaying the next stuck-task intervention and making intermittent stalls difficult to diagnose.

## Finding 4 — Task-change callback failures can propagate out of task hooks/tools without local observability

**Severity:** High

**Violated contract:**
- **Invariant:** Task callback failures must not destabilize host hook/tool execution and must be observable when suppressed.
- **Postcondition:** Task-state mutation or reload either completes its notification callback safely or reports callback failure through an observable channel without corrupting the task operation.

**Exact references:**
- `tools/task.ts:51-55` — `notifyChange = () => onTaskChange?.([...tasks])` directly invokes the callback.
- `tools/task.ts:70-78` — `reloadState(ctx)` calls `notifyChange()` after session reload.
- `tools/task.ts:84-85` — `session_start` and `session_tree` hooks call `reloadState(ctx)` directly.
- `tools/task.ts:126-146` — mutating task tool execution calls `notifyChange()` before persistence.
- `index.ts:61-123` — registered task-change callback catches widget/notification failures internally.
- `index.ts:121-123` — that catch is silent: `// Widget update must never crash the task tool`.

**Concrete counterexample path:**
1. A mutating task action succeeds in `tools/task.ts:131-139`, changing in-memory task state.
2. Because `result.details.mutated` is true, execution calls `notifyChange()` at `tools/task.ts:143`.
3. `notifyChange()` invokes `onTaskChange` at `tools/task.ts:55`.
4. If a registered callback throws outside its own internal catch, the exception propagates out of the task tool because `tools/task.ts` has no local catch around `notifyChange()`.
5. With the current callback in `index.ts:61-123`, UI failures are caught, but the catch at `index.ts:121-123` suppresses them without logging, diagnostics, or fallback notification.

**Runtime impact:**
A task mutation can appear to fail at the tool boundary because a callback failed after the state already changed. With the current UI callback, widget/notification failures are hidden, so the user can lose task UI updates without any indication that the task model and UI have diverged.

## Finding 5 — Task persistence failures propagate after in-memory mutation without observable recovery state

**Severity:** Critical

**Violated contract:**
- **Invariant:** Persistence failures must be observable and must not silently create task-state drift.
- **Postcondition:** After a mutating task action, either the new task state is durably appended or the user/tool result clearly reports that persistence failed and the in-memory/session state may diverge.

**Exact references:**
- `tools/task.ts:80-81` — `persistState()` calls `pi.appendEntry(TASK_ENTRY_TYPE, { tasks: [...tasks], nextId })` with no local error handling.
- `tools/task.ts:126-146` — task tool `execute` mutates state, calls `notifyChange()`, then calls `persistState()`.
- `tools/task-actions.ts:36-44` — `executeAdd()` mutates `tasks` and increments `nextId`.
- `tools/task-actions.ts:50-64` — `executeStart()` mutates task status to `in_progress`.
- `tools/task-actions.ts:70-86` — `executeDoneOrExpire()` mutates task status to `done` or `expired`.

**Concrete counterexample path:**
1. User calls the task tool with `action: "done"`.
2. `executeDoneOrExpire(...)` sets the task status to `done` at `tools/task-actions.ts:80-82`.
3. Control returns to `tools/task.ts:141-145` with `result.details.mutated === true`.
4. `notifyChange()` runs at `tools/task.ts:143`, updating UI/callback consumers from in-memory state.
5. `persistState()` runs at `tools/task.ts:144`.
6. `pi.appendEntry(...)` throws at `tools/task.ts:80-81`, for example because the session store is unavailable.
7. There is no local catch that records a diagnostic, emits UI notification, rolls back memory, or returns a structured task-tool error explaining that persistence failed after mutation.

**Runtime impact:**
The current process can show the task as completed while the durable session log still contains the old state. On session reload, compaction, or process restart, the task can reappear as pending/in-progress. This directly matches the suspected intermittent behavior: task-state drift with root cause hidden behind a host persistence exception.

## Finding 6 — Session reload host API failures can throw from task lifecycle hooks without task-specific observability

**Severity:** Medium

**Violated contract:**
- **Invariant:** Host API failures in task hooks must not be hidden or destabilize lifecycle hook execution; they must be observable.
- **Precondition:** `session_start`/`session_tree` reload may rely on host session APIs that can fail.
- **Postcondition:** Reload failure emits a task-specific diagnostic or UI/log warning and leaves a well-defined task state.

**Exact references:**
- `tools/task.ts:70-78` — `reloadState(ctx)` resets `tasks` and `nextId`, then iterates `ctx.sessionManager.getEntries()`.
- `tools/task.ts:77` — `reloadState(ctx)` calls `notifyChange()` after loading.
- `tools/task.ts:84-85` — `session_start` and `session_tree` hooks directly call `reloadState(ctx)`.

**Concrete counterexample path:**
1. Host fires `session_start` or `session_tree`.
2. The task hook calls `reloadState(ctx)` at `tools/task.ts:84-85`.
3. `reloadState` resets in-memory `tasks = []` and `nextId = 1` at `tools/task.ts:71-72`.
4. `ctx.sessionManager.getEntries()` throws at `tools/task.ts:73`, for example due to session read failure or malformed host state.
5. No local catch emits a task-specific UI warning, log, or diagnostic.
6. The in-memory task state has already been cleared before the failed reload completes.

**Runtime impact:**
A session reload failure can leave the plugin with an empty in-memory task list and no task-specific explanation. Boulder then observes no active tasks and may stop continuing even though persisted tasks still exist, producing intermittent disappearance of work until a later successful reload.
