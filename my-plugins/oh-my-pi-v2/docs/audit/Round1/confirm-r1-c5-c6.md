# Round 1 Confirmation: R1-C5 / R1-C6

Scope constraints honored: read `docs/audit/Round1/round-context.md` plus source/runtime files needed for Boulder behavior; did not read other audit or candidate reports.

## R1-C5 — Boulder hook failures are swallowed without observability/disablement

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. `index.ts` registers Boulder when `config.boulder_enabled !== false`, passing `() => continuationStopped` as the only stop predicate.
2. `hooks/boulder.ts` `registerBoulder()` installs the `agent_end` hook.
3. The `agent_end` hook wraps the whole Boulder decision path in one top-level `try` block.
4. Its `catch` block contains only the comment `// Hooks must never throw` and performs no `notify`, logging, counter increment, state transition, or disablement.

Failure trigger examples from the same path include any exception thrown while reading task state, message/history fields, suppression helpers, countdown setup, or other logic before the restart send-specific catch is reached. Those exceptions are swallowed by the empty `agent_end` catch.

Why this matches the claim:

- Round context requires Boulder hook failures to be non-throwing but observable, and repeated failures to disable Boulder and notify the user.
- Source confirms non-throwing behavior, but the top-level hook failure path has no observability and no repeated-failure disable mechanism.
- The only Boulder runtime disable/stop controls found are config-time `boulder_enabled !== false` and manual `/omp-stop` via `continuationStopped`; neither is driven by swallowed hook failures.

## R1-C6 — repeated restart injection failures warn but do not disable Boulder

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. `agent_end` detects pending active work and prepares a restart message.
2. It starts a visible or silent countdown.
3. Countdown completion calls `fire`, which re-checks stop/compaction/running-task conditions, refreshes task state, rebuilds the restart message, then calls `sendRestart(pi, ctx, freshMessage)`.
4. `sendRestart()` calls `pi.sendUserMessage(...)` or `pi.sendUserMessage(..., { deliverAs: "followUp" })` depending on idle state.
5. If `sendUserMessage` throws, `sendRestart()` increments module-level `injectionFailures`.
6. Once `injectionFailures >= MAX_INJECTION_FAILURES` and UI is available, it calls `ctx.ui.notify("Boulder: gave up after 5 injection failures. Use /omp-continue to retry.", "warning")`.

Why this matches the claim:

- The warning exists at the repeated-failure threshold (`MAX_INJECTION_FAILURES = 5`).
- No source path found at that threshold sets `continuationStopped`, flips `boulder_enabled`, unregisters the `agent_end` hook, records a disabled state, or otherwise prevents future Boulder attempts.
- Subsequent `agent_end` executions still evaluate Boulder normally. The accumulated `injectionFailures` only affects exponential backoff and restart message text (`Auto-restart after N injection failure(s). Backoff active.`).
- A later successful `sendUserMessage` resets `injectionFailures = 0`, confirming the state is a retry/backoff counter rather than a disable latch.

Therefore repeated restart injection failures are observable via warning when UI exists, but Boulder remains reachable and retry-capable rather than fail-closed/disabled.
