# Round 1 Audit — Resource Lifecycle and Async Concurrency

Scope: omp-v2 Boulder countdown/hooks under the Round 1 spec. This report contains Hoare findings only.

## Finding 1 — Blocked pending tasks can keep Boulder restarting with no actionable work

- **Severity:** High
- **Violated invariant:** Boulder active-work invariant: automatic continuation is permitted only when active work exists, where active work is `in_progress` or `ready` pending work. Blocked pending tasks alone must not trigger continuation.
- **Violated pre/post:**
  - **Pre:** At `agent_end`, `getTaskState()` may contain pending tasks whose blockers are not terminal.
  - **Required post:** If no task is `in_progress` and no pending task is unblocked, Boulder must not start a countdown or inject a restart.
  - **Actual post:** Boulder treats any `pending` or `in_progress` task as restartable work through `pendingCount` and its task filters.
- **Exact references:**
  - `my-plugins/oh-my-pi-v2/tools/task.ts:39-49` defines actionable work as `in_progress` plus pending tasks that satisfy `isUnblocked(...)`.
  - `my-plugins/oh-my-pi-v2/tools/task.ts:155-160` exposes `pendingCount` as all `pending` or `in_progress` tasks while `readyTasks` includes only unblocked pending tasks.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:82-84` suppresses Boulder only when `pendingCount === 0`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:119-120` includes all `pending` and `in_progress` task IDs in stagnation tracking.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:149-155` rechecks only fresh `pendingCount` before firing.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:198-218` builds the restart message from all `pending` and `in_progress` tasks.
  - `my-plugins/oh-my-pi-v2/tools/task-actions.ts:50-65` refuses to start a blocked pending task.
- **Concrete counterexample path:**
  1. Task state contains task `#1` with status `pending` and `blockedBy: [2]`; task `#2` exists and is still `pending` or `in_progress`, so `#1` is not unblocked.
  2. No other task is `in_progress` or ready pending.
  3. `getTaskState()` returns `pendingCount === 1` or greater because `pendingCount` counts all pending/in-progress tasks.
  4. `agent_end` enters `registerBoulder` and passes the `pendingCount === 0` guard in `boulder.ts:82-84`.
  5. The countdown starts at `boulder.ts:162-164`; when it fires, `fire()` rechecks only `fresh.pendingCount === 0` at `boulder.ts:153-155` and still proceeds.
  6. `sendRestart()` injects a restart prompt listing the blocked task via `buildRestartMessage()`.
  7. The restarted agent cannot legally start the blocked task because `executeStart()` rejects blocked starts in `task-actions.ts:50-65`.
- **Runtime impact:** Boulder can repeatedly wake the agent when there is no actionable work. This produces runaway continuation, token spend, and UI churn. After repeated cycles, the stagnation path can also send the user a continuation prompt for a task that the task tool itself refuses to start.

## Finding 2 — Hook-local catch blocks hide Boulder and compaction-recovery failures instead of making them observable or disabling Boulder after repeats

- **Severity:** Medium
- **Violated invariant:** Hook failures must be non-throwing but observable, and repeated Boulder hook/injection failures must disable Boulder after repeats.
- **Violated pre/post:**
  - **Pre:** A hook callback can throw during Boulder lifecycle processing or compaction task-restoration processing.
  - **Required post:** The hook must not crash the host, but the failure must be observable through the pi hook error path, UI, log, counter, or a Boulder disable path.
  - **Actual post:** Several failures are caught and discarded inside omp-v2 hook code, preventing the host hook runner from observing them.
- **Exact references:**
  - `packages/coding-agent/src/core/extensions/runner.ts:589-620` shows the hook runner awaits handlers and reports thrown/rejected handler errors via `emitError(...)`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:77-167` wraps the entire `agent_end` Boulder handler in `try/catch`; `boulder.ts:165-167` has an empty catch body except the non-throwing comment.
  - `my-plugins/oh-my-pi-v2/hooks/context-recovery.ts:89-107` wraps `session_compact` restoration in `try/catch`; `context-recovery.ts:105-107` also discards the error.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:185-195` increments `injectionFailures` on synchronous stagnation-injection throws but never notifies or disables Boulder there.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:226-241` only warns after synchronous `sendRestart()` throws reach `MAX_INJECTION_FAILURES`.
- **Concrete counterexample path:**
  1. A visible countdown finishes and calls Boulder `fire()` from `boulder.ts:149-159`.
  2. Inside `fire()`, `getTaskState()` or another guard call throws due to malformed in-memory task state or a task-state access error.
  3. The exception propagates back through the countdown `onFinish()` into the `agent_end` handler stack created in `boulder.ts:77-167`.
  4. The local catch at `boulder.ts:165-167` consumes the exception.
  5. Because the handler resolves normally, the host runner catch/report path at `extensions/runner.ts:589-620` never receives the error and cannot surface it.
  6. No Boulder failure counter is incremented in this catch, no UI notification is emitted, and Boulder is not disabled.

  A compaction-restoration variant follows the same pattern: during `session_compact`, `context-recovery.ts:89-104` clears per-session guards and attempts `getTaskState()`/`pi.sendUserMessage(...)`; a synchronous throw is swallowed by `context-recovery.ts:105-107`, bypassing the runner error reporting path.
- **Runtime impact:** Users and operators can see missing restarts, missing compaction restoration prompts, or repeated broken continuation behavior without any observable error. For Boulder-specific lifecycle failures, the Round 1 repeated-failure disable requirement is not enforceable because the broad `agent_end` catch does not count or report failures.

## Finding 3 — Async `sendUserMessage` failures from Boulder and compaction recovery are not observed by the hook code

- **Severity:** Medium
- **Violated invariant:** Message-injection failure must be observable and must feed Boulder failure accounting/disable behavior after repeats.
- **Violated pre/post:**
  - **Pre:** `pi.sendUserMessage` can reject asynchronously because runtime `sendUserMessage(...)` awaits `prompt(...)`, and `prompt(...)` can reject for non-streaming model/auth errors or other prompt failures.
  - **Required post:** A failed continuation or restoration injection must be observed by the hook code that owns the lifecycle decision, and Boulder injection failure accounting must reflect the failed injection.
  - **Actual post:** omp-v2 hooks call `pi.sendUserMessage(...)` without `await`; their `try/catch` blocks catch only synchronous throws and then reset failure counters as if injection succeeded.
- **Exact references:**
  - `packages/coding-agent/src/core/extensions/loader.ts:221-230` exposes `sendUserMessage(content, options): void` to extensions and forwards to `runtime.sendUserMessage(content, options)`.
  - `packages/coding-agent/src/core/agent-session.ts:1288-1322` implements runtime `sendUserMessage(...)` as `async` and awaits `this.prompt(...)`.
  - `packages/coding-agent/src/core/agent-session.ts:999-1021` shows non-streaming `prompt(...)` can throw for no selected model, OAuth failure, or missing API key.
  - `packages/coding-agent/src/core/agent-session.ts:980-994` shows streaming prompt queueing is asynchronous and awaited inside `prompt(...)`.
  - `packages/coding-agent/src/core/agent-session.ts:2148-2166` shows the bound core path reports async `sendUserMessage` rejections through `runner.emitError(...)`, not through the calling extension's local `try/catch`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:185-195` and `boulder.ts:226-241` call `pi.sendUserMessage(...)` without `await` and reset `injectionFailures = 0` immediately after the call returns.
  - `my-plugins/oh-my-pi-v2/hooks/context-recovery.ts:89-104` calls `pi.sendUserMessage(..., { deliverAs: "followUp" })` without `await` during compaction restoration.
- **Concrete counterexample path:**
  1. Boulder countdown fires while the agent is idle, so `sendRestart()` uses the non-streaming `pi.sendUserMessage(message)` path in `boulder.ts:226-230`.
  2. The extension-facing API call returns immediately through `extensions/loader.ts:221-230`; Boulder executes `injectionFailures = 0` at `boulder.ts:237` and exits the `try` block.
  3. Runtime `sendUserMessage(...)` continues asynchronously and awaits `prompt(...)` at `agent-session.ts:1315-1322`.
  4. `prompt(...)` rejects because no model is selected or no API key is configured, as shown in `agent-session.ts:999-1021`.
  5. The rejection is reported by the bound core path as a runner error at `agent-session.ts:2159-2165`, but Boulder does not receive it, does not increment `injectionFailures`, and does not reach the `MAX_INJECTION_FAILURES` warning/disable branch.
- **Runtime impact:** The continuation prompt can fail to enqueue while Boulder records success. Repeated async injection failures never accumulate in Boulder’s failure counter, so users can experience missing restarts without Boulder disabling itself or emitting the intended Boulder warning. The same unawaited pattern can lose compaction-restoration follow-up delivery from `context-recovery.ts:89-104`.

## Finding 4 — `activeCountdown` retains a completed handle after natural countdown completion

- **Severity:** Low
- **Violated invariant:** `activeCountdown` should represent an actually active countdown resource; after completion or cancellation there should be no live active countdown reference.
- **Violated pre/post:**
  - **Pre:** A Boulder countdown reaches zero and runs its finish callback.
  - **Required post:** Timer/input resources are cleaned up and Boulder clears `activeCountdown` because no countdown remains active.
  - **Actual post:** The countdown implementation clears its interval/input subscription, but Boulder never clears the module-level `activeCountdown` reference after natural completion.
- **Exact references:**
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:46-48` declares module-level `activeCountdown`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:78-80` cancels and clears a previous handle at the next `agent_end`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:149-159` defines the countdown `fire()` callback and calls `sendRestart(...)` without clearing `activeCountdown`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:162-164` assigns the handle returned by `startCountdown(...)` or `startSilentCountdown(...)` to `activeCountdown`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder-countdown.ts:53-57` clears visible countdown resources and then calls `onFinish()` when the interval reaches zero.
  - `my-plugins/oh-my-pi-v2/hooks/boulder-countdown.ts:87-97` clears silent countdown completion through the timeout callback but does not inform Boulder to clear the stored handle.
- **Concrete counterexample path:**
  1. `agent_end` starts a visible countdown and stores its handle in `activeCountdown` at `boulder.ts:162-164`.
  2. The interval reaches zero in `boulder-countdown.ts:53-57`; `cleanup()` clears the interval, status, and input subscription, then calls Boulder `fire()`.
  3. `fire()` in `boulder.ts:149-159` sends or attempts the restart and returns.
  4. No code in `fire()` or `startCountdown()` clears Boulder’s module-level `activeCountdown`.
  5. Until the next `agent_end`, `session_start`, `session_tree`, or reset path, `activeCountdown` still points at a completed handle.
- **Runtime impact:** This is not a timer leak after normal visible completion because `cleanup()` clears the interval and unsubscribes Esc input. The observable risk is stale lifecycle state: later reset paths call `cancel()` on an already-completed handle and code that reasons about `activeCountdown` as live state will be wrong. It also increases the chance of future changes accidentally treating a completed countdown as active.

## NONE — Esc one-shot cancellation

No finding. Visible Esc cancellation remains one-shot for the current countdown handle: `startCountdown()` checks `!cancelled` before handling Escape, `cleanup()` sets `cancelled = true`, clears the interval/status, and unsubscribes input, and `cancel()` is idempotent (`my-plugins/oh-my-pi-v2/hooks/boulder-countdown.ts:48-80`). Esc cancellation does not call `onFinish()`, so it cancels only the current countdown attempt and does not create persistent stop state.
