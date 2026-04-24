# Round 1 Protocol/State-Machine Audit — Boulder

Scope: `omp-v2` Boulder protocol/state-machine correctness under the Round 1 decisions in `round-context.md`. Findings below are Hoare-style violations only.

## Findings

### PSM-01 — `/omp-stop` still creates persistent Boulder stop state

- **Severity:** High
- **Violated invariant:** `NoPersistentStop`: Boulder has no command-level persistent stop state; Esc cancellation is the only user cancellation mechanism and is one-shot for the current countdown/restart attempt.
- **Violated postcondition:** After plugin registration, the command surface must not expose `/omp-stop`, and Boulder restart eligibility must not be gated by a command-set stop latch.
- **Exact references:**
  - `my-plugins/oh-my-pi-v2/index.ts:53-54` — module-local `continuationStopped` state.
  - `my-plugins/oh-my-pi-v2/index.ts:127-132` — passes `() => continuationStopped` into `registerBoulder`.
  - `my-plugins/oh-my-pi-v2/index.ts:147-154` — registers `omp-stop` and sets `continuationStopped = true`.
  - `my-plugins/oh-my-pi-v2/index.ts:156-162` — clears the stop latch only on the next `before_agent_start`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:63-68` — `registerBoulder` accepts `isStopped`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:83` and `149-152` — Boulder suppresses restart when `isStopped?.()` is true.
- **Concrete counterexample path:**
  1. Plugin loads with Boulder enabled; `continuationStopped = false`.
  2. User runs `/omp-stop` after an agent turn with remaining tasks.
  3. `index.ts:147-154` sets `continuationStopped = true` and notifies the user.
  4. A subsequent `agent_end` fires while task state still contains active work.
  5. `hooks/boulder.ts:83` returns before task-state/actionability checks, or an already scheduled countdown reaches `fire()` and `hooks/boulder.ts:149-152` returns.
  6. Auto-continuation stays suppressed until an unrelated new agent start resets the flag in `index.ts:156-162`.
- **Runtime impact:** Boulder has a command-level persistent stop protocol that the Round 1 spec removed. A stale `/omp-stop` latch can prevent required continuation despite remaining active work, and users may rely on an unsupported stop mode instead of the one-shot Esc cancellation semantics.

### PSM-02 — Boulder treats blocked pending tasks as active continuation work

- **Severity:** Critical
- **Violated invariant:** `ActiveWork == in_progress + ready`; ready means pending and unblocked. Blocked pending tasks alone must not trigger automatic continuation.
- **Violated precondition:** `sendRestart(ctx, state)` may be reached only when `state.inProgressCount > 0 || state.readyTasks.length > 0`.
- **Exact references:**
  - `my-plugins/oh-my-pi-v2/tools/task.ts:21-23` — provider exposes `pendingCount`, `inProgressCount`, and `readyTasks`.
  - `my-plugins/oh-my-pi-v2/tools/task.ts:35-49` — actionable tasks are `in_progress` plus `pending && isUnblocked(...)`.
  - `my-plugins/oh-my-pi-v2/tools/task.ts:154-160` — `pendingCount` counts all `pending` or `in_progress` tasks, while `readyTasks` filters pending tasks through `isUnblocked`.
  - `my-plugins/oh-my-pi-v2/tools/task-helpers.ts:32-38` — `isUnblocked` defines dependency readiness.
  - `my-plugins/oh-my-pi-v2/index.ts:68-70` — non-Boulder UI completion logic correctly uses `in_progress || (pending && isUnblocked)`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:29-32` — Boulder narrows task state to only `tasks` and `pendingCount`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:85-90` and `154-159` — Boulder gates restart only on `pendingCount !== 0`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:198-203` — restart prompt lists all `pending` and `in_progress` tasks.
- **Concrete counterexample path:**
  1. Task state contains task `#1` with status `pending` and `blockedBy: [2]`; task `#2` is also pending or otherwise not done/expired, so `isUnblocked(#1, tasks) === false`.
  2. No task is `in_progress`, and no pending task is unblocked, so the Round 1 active-work predicate is false.
  3. `tools/task.ts:154-160` still returns `pendingCount > 0` because blocked pending tasks count as pending.
  4. On `agent_end`, `hooks/boulder.ts:85-90` proceeds because `pendingCount !== 0`.
  5. After countdown, `hooks/boulder.ts:154-159` re-checks only `fresh.pendingCount !== 0`, then `sendRestart` injects a follow-up prompt.
  6. The restart prompt at `hooks/boulder.ts:198-203` includes blocked pending tasks as work to continue.
- **Runtime impact:** Boulder can enter runaway or noisy continuation on dependency-blocked work that is not actionable. The injected follow-up can repeatedly ask the agent to continue when the state machine has no ready transition, causing loops, unnecessary turns, and user-visible instability.

### PSM-03 — Hook failures can be swallowed without observability or disablement

- **Severity:** High
- **Violated invariant:** Hook failures do not throw into the host, but every Boulder hook failure is observable through diagnostics/log/UI warning, and repeated failures disable Boulder and notify the user.
- **Violated postcondition:** If Boulder catches an exception from its hook path, it must record/surface the failure; after the repeated-failure threshold, it must transition to a disabled state that prevents further automatic restarts.
- **Exact references:**
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:75-167` — `agent_end` hook wraps the whole restart protocol.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:165-167` — outer `catch` swallows all exceptions with only the comment `Hooks must never throw`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:173-195` — stagnation notification send failure increments `injectionFailures`, then resets `stagnationCount` without disabling Boulder.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:221-242` — restart injection failures increment `injectionFailures`; at five failures, the only consequence is an optional UI warning.
  - `packages/agent/src/types.ts:269-274` and `330-340` — `agent_end` listeners are awaited and the agent becomes idle only after they settle.
  - `packages/coding-agent/src/core/extensions/types.ts:1133-1140` and `packages/coding-agent/src/core/agent-session.ts:1294-1325` — `sendUserMessage` always triggers a turn and is async in the implementation.
  - `packages/coding-agent/src/core/extensions/runner.ts:183-211` — in no-UI contexts, `notify`, `onTerminalInput`, and `setStatus` can be no-ops.
- **Concrete counterexample path:**
  1. An `agent_end` event reaches `registerBoulder` while tasks remain active.
  2. Any unexpected exception occurs before `sendRestart`'s local catch, for example from `getTaskState()`, `hasRunningTasks?.()`, countdown setup, a UI method in countdown setup, or a helper invoked in the guarded block.
  3. The outer `catch` at `hooks/boulder.ts:165-167` absorbs the exception and emits no diagnostic, log entry, UI warning, counter transition, or disabled state.
  4. Because `agent_end` listeners are awaited by the framework, the exception is hidden from the host, but the user sees only that Boulder did not restart.
  5. The same failing path can repeat on every later `agent_end`; there is no repeated-failure transition that disables Boulder and notifies the user.
- **Runtime impact:** This matches the reported intermittent stop-hook failure pattern: failures are host-safe but invisible, making diagnosis impossible. Repeated failures can leave Boulder in a silently degraded loop instead of a clear disabled state.

### PSM-04 — Repeated `sendUserMessage` failures warn but do not disable Boulder

- **Severity:** High
- **Violated invariant:** Repeated Boulder hook failures disable Boulder and notify the user.
- **Violated postcondition:** Once `injectionFailures >= MAX_INJECTION_FAILURES`, Boulder must enter a disabled state such that future `agent_end` and countdown `fire()` paths do not call `sendUserMessage` again unless explicitly re-enabled.
- **Exact references:**
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:36` — `MAX_INJECTION_FAILURES = 5`.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:69-75` — session lifecycle resets counters but defines no `disabled` state.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:221-242` — `sendRestart` catches injection errors, increments `injectionFailures`, optionally notifies at the threshold, and returns.
  - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:75-164` — future `agent_end` executions do not check a disabled flag before scheduling another countdown/restart.
  - `packages/coding-agent/src/core/extensions/types.ts:1133-1140` — `sendUserMessage` always triggers a turn.
- **Concrete counterexample path:**
  1. Task state remains active and `sendUserMessage` fails due to queue/session/runtime instability.
  2. `sendRestart` catches the error at `hooks/boulder.ts:221-242` and increments `injectionFailures`.
  3. Steps 1-2 repeat until `injectionFailures === 5`; Boulder emits a warning only if `ctx.hasUI` is true.
  4. No `disabled` flag is set, and no future guard checks `injectionFailures >= MAX_INJECTION_FAILURES` before scheduling restart.
  5. The next `agent_end` with active tasks again schedules a countdown and calls `sendUserMessage`, increasing failure count and repeating the unstable path.
- **Runtime impact:** The failure threshold is advisory only. In UI contexts the user gets a warning, but Boulder keeps attempting injections; in no-UI contexts even the warning can be absent. This violates the required fail-closed state-machine transition and can amplify host instability through repeated failing async sends.
