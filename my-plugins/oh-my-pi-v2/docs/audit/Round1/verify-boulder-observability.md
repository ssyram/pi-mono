# Round 1 Verification: Boulder Error Observability and Disablement

Scope: verified from `hooks/boulder.ts`, `hooks/boulder-countdown.ts`, and pi API source/docs only. Prior audit/confirm reports were not read. Allowed context: `docs/audit/Round1/round-context.md`.

## Summary

| Fix point | Result |
| --- | --- |
| Boulder hook catch logs/records failures | PASS |
| Repeated synchronous Boulder failures disable Boulder and notify/log | PASS |
| Restart/stagnation synchronous send failures use shared failure accounting | PASS |
| Active countdown handle clears after natural fire | PASS |
| Async `sendUserMessage` failure observability from extension code | LIMITATION REMAINS |

## Evidence

### 1. Boulder hook catch logs/records failures — PASS

Evidence:

- `hooks/boulder.ts:86-88` wraps the `agent_end` hook body in `try { ... }` and immediately returns if Boulder is disabled.
- `hooks/boulder.ts:173-175` catches hook-level exceptions and calls `recordBoulderFailure(ctx, "Boulder hook failed", err)`.
- `hooks/boulder.ts:196-204` implements `recordBoulderFailure`: increments `injectionFailures`, logs to console with `[oh-my-pi boulder] ${message}: ...`, disables on threshold, cancels/clears any countdown, and notifies the user.

Verdict: hook exceptions no longer throw through the hook path silently; they enter shared Boulder failure accounting and are console-observable.

### 2. Repeated synchronous Boulder failures disable Boulder and notify/log — PASS

Evidence:

- `hooks/boulder.ts:44` defines `MAX_INJECTION_FAILURES = 5`.
- `hooks/boulder.ts:56-57` holds module state for `activeCountdown` and `disabled`.
- `hooks/boulder.ts:196-204` increments `injectionFailures`, logs each recorded failure, and when `injectionFailures >= MAX_INJECTION_FAILURES`:
  - sets `disabled = true`,
  - cancels `activeCountdown`,
  - clears `activeCountdown = undefined`,
  - calls `notifyBoulderFailure(ctx, "Boulder auto-continuation disabled after repeated failures. Use manual prompts until the issue is resolved.")`.
- `hooks/boulder.ts:188-193` sends a UI warning via `ctx.ui.notify(..., { type: "warning" })`; if notification itself fails, it logs `[oh-my-pi boulder] Failed to notify user: ...`.
- `hooks/boulder.ts:86-88` causes future `agent_end` handling to return immediately once `disabled` is true.

Verdict: repeated recorded synchronous failures disable Boulder, log, cancel pending countdown state, and attempt user notification with fallback logging if notification fails.

### 3. Restart/stagnation synchronous send failures use shared failure accounting — PASS

Evidence:

- Stagnation path:
  - `hooks/boulder.ts:219-228` wraps stagnation `pi.sendUserMessage(...)` calls in `try/catch`.
  - On success it resets `injectionFailures = 0`.
  - On synchronous throw it calls `recordBoulderFailure(ctx, "Failed to send stagnation message", err)`.
- Restart path:
  - `hooks/boulder.ts:256-270` wraps restart `pi.sendUserMessage(...)` calls in `try/catch`.
  - On success it resets `injectionFailures = 0`.
  - On synchronous throw it calls `recordBoulderFailure(ctx, "Failed to send restart message", err)`.
- Both paths therefore share the same accounting and disablement behavior from `hooks/boulder.ts:196-204`.

Verdict: synchronous `sendUserMessage` failures in both stagnation and restart paths are counted through the same Boulder failure mechanism.

### 4. Active countdown handle clears after natural fire — PASS

Evidence:

- `hooks/boulder.ts:90-92` cancels and clears any previous `activeCountdown` when a new `agent_end` pass begins.
- `hooks/boulder.ts:156-168` passes a natural-fire callback to countdown creation; the first statement in that callback is `activeCountdown = undefined` before disabled/guard checks, task refresh, or `sendRestart(...)`.
- UI countdown resource cleanup:
  - `hooks/boulder-countdown.ts:44-49` defines `cleanup()` to set `cancelled = true`, clear interval ticker, clear status, and unsubscribe terminal input.
  - `hooks/boulder-countdown.ts:53-58` calls `cleanup()` before `onFinish()` on natural expiry.
- Silent countdown behavior:
  - `hooks/boulder-countdown.ts:83-98` uses `setTimeout`; natural timeout calls `onFinish()` if not cancelled, and cancellation clears the timeout.
  - The Boulder module-level handle is still cleared by the `hooks/boulder.ts:156-168` natural-fire callback.

Verdict: both UI countdown resources and Boulder’s module-level `activeCountdown` handle are cleared on natural fire before restart send logic runs.

## Remaining limitation: async `sendUserMessage` failures

This appears to remain a host API limitation rather than a missed synchronous fix.

Evidence:

- `packages/coding-agent/src/core/extensions/types.ts:1356-1359` declares `SendUserMessageHandler` as returning `void`.
- `packages/coding-agent/src/core/extensions/loader.ts:226-227` exposes `sendUserMessage(content, options): void { runtime.sendUserMessage(content, options); }`, with no returned promise/handle for extension callers.
- `packages/coding-agent/src/core/agent-session.ts:2159-2164` binds runtime `sendUserMessage` by calling `this.sendUserMessage(content, options).catch(...)` and emitting `runner.emitError({ event: "send_user_message", ... })` on rejection.
- `packages/coding-agent/docs/extensions.md:1175` documents `pi.sendUserMessage(content, options?)`; nearby docs state missing `deliverAs` while streaming throws, but do not document a returned promise or async rejection handling contract for plugins.

Verdict: Boulder can catch synchronous throws from `pi.sendUserMessage`, including documented API misuse cases, but cannot directly observe asynchronous delivery failures through the extension-facing return value because the public handler returns `void` and async rejections are handled internally by the runtime error channel.

## Final verdict

All requested Round 1 fix points pass for synchronous Boulder failure modes and countdown cleanup. The only remaining limitation is async `sendUserMessage` delivery failure observability, which is consistent with the current pi API shape returning `void` to extensions.
