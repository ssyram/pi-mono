# Fresh-eyes confirmation: R1-C7 / R1-C8

Scope constraints observed: I read `docs/audit/Round1/round-context.md` and source/runtime files needed to verify the two claims. I did not read other audit or candidate reports.

## R1-C7 — async `sendUserMessage` failures are not observable to Boulder failure accounting because extension API returns void

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. Boulder restart injection calls the extension API inside `sendRestart(...)`:
   - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:221-242`
   - It wraps `pi.sendUserMessage(...)` in `try/catch` and increments `injectionFailures` only in that catch.
   - The call is not awaited.
2. The extension-facing API contract is void-returning:
   - `packages/coding-agent/src/core/extensions/types.ts:1133-1140` declares `sendUserMessage(...): void`.
   - `packages/coding-agent/src/core/extensions/loader.ts:221-228` implements `sendUserMessage(content, options): void { runtime.sendUserMessage(content, options); }`, with no returned promise.
3. The host session implementation is actually async:
   - `packages/coding-agent/src/core/agent-session.ts:1294-1324` defines async `sendUserMessage(...)` and awaits `this.prompt(...)`.
4. The runtime action wrapper consumes async failures internally:
   - `packages/coding-agent/src/core/agent-session.ts:2159-2165` calls `this.sendUserMessage(content, options).catch(...)` and emits a runner error for event `send_user_message`.

Because Boulder receives a `void` extension API and does not await anything, Boulder can only count synchronous throws from `pi.sendUserMessage(...)`. Any asynchronous failure from the underlying session/prompt path is caught by the host runtime wrapper and reported through runner error handling, not propagated back to Boulder's `try/catch`. Therefore async `sendUserMessage` failures are not observable to Boulder's `injectionFailures` accounting and cannot trigger Boulder's max-failure warning/disable path.

## R1-C8 — stagnation stop-message failure is unobservable and resets stagnation count

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. Boulder detects stagnation from unchanged active task IDs:
   - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:119-135`
   - When `stagnationCount >= 3`, it calls `handleStagnation(pi, ctx, pendingCount)` and returns.
2. `handleStagnation(...)` sends the stop/stuck message:
   - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:173-195`
   - The message says the agent appears stuck and that auto-continuation is stopping.
   - It calls `pi.sendUserMessage(msg)` when idle or `pi.sendUserMessage(msg, { deliverAs: "followUp" })` otherwise.
3. Failure handling in this path is not user-observable:
   - The `catch` only does `injectionFailures++`.
   - It has no `ctx.ui.notify(...)`, no log, no rethrow, and no disable/warning branch.
   - This differs from `sendRestart(...)`, whose catch can notify after `MAX_INJECTION_FAILURES` at `my-plugins/oh-my-pi-v2/hooks/boulder.ts:237-242`.
4. The stagnation counter is reset after the send attempt regardless of success:
   - `my-plugins/oh-my-pi-v2/hooks/boulder.ts:195` sets `stagnationCount = 0` after the `try/catch`.

For a synchronous `pi.sendUserMessage(...)` throw in the stagnation path, the only local effect is `injectionFailures++`; the user receives no UI/log warning from this handler, and `stagnationCount` is still reset to zero. For an asynchronous failure, R1-C7's void API path applies as well: the failure does not enter Boulder's catch at all, and `stagnationCount` still resets. Either way, the stagnation stop-message failure is not observable through Boulder diagnostics/UI and the stagnation count is cleared.
