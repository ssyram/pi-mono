# Round 1 Audit — External pi API Contracts

Scope: external `@mariozechner/pi-coding-agent` contracts used by `my-plugins/oh-my-pi-v2` Boulder/task hooks, checked against package source.

## Finding R1-EXT-001 — Boulder injection failure accounting cannot observe async `sendUserMessage` failures

**Violated Postcondition:** After a Boulder restart/stagnation injection attempt, if the host rejects or fails the user-message injection, Boulder records the failure in `injectionFailures`; after repeated failures Boulder disables/gives up and surfaces a warning.

**Concrete counterexample path:**
1. `my-plugins/oh-my-pi-v2/hooks/boulder.ts:185-195` (`handleStagnation`) or `my-plugins/oh-my-pi-v2/hooks/boulder.ts:226-240` (`sendRestart`) calls `pi.sendUserMessage(...)` inside a synchronous `try/catch` and resets `injectionFailures = 0` immediately after the call returns.
2. The extension-facing implementation is `void`: `packages/coding-agent/src/core/extensions/loader.ts:221-228` delegates `sendUserMessage(content, options): void` to `runtime.sendUserMessage(...)`.
3. Runtime binding does not throw the async failure to the caller: `packages/coding-agent/src/core/agent-session.ts:2159-2164` calls `this.sendUserMessage(content, options).catch(...)` and reports errors via `runner.emitError({ extensionPath: "<runtime>", event: "send_user_message", ... })`.
4. The underlying implementation is async: `packages/coding-agent/src/core/agent-session.ts:1292-1325` awaits `this.prompt(...)`; `prompt()` can reject, e.g. non-streaming prompt preflight throws for no selected model or invalid/missing auth at `packages/coding-agent/src/core/agent-session.ts:999-1021`.
5. Because the extension API call returns `void` and runtime catches async rejection internally, Boulder’s local `catch` is not entered, so `injectionFailures` remains reset to `0` even though no restart was delivered.

**Runtime impact:** Boulder can silently believe continuation was injected when the host rejected it. Backoff/disable logic tied to `injectionFailures` does not activate for async host failures, so active tasks may remain stuck without the Round 1 required observable repeated-failure shutdown. The user may see a generic host extension error, but Boulder state does not reflect failure and does not disable itself after repeats.

**Severity:** High

**Exact package source references:**
- `packages/coding-agent/src/core/extensions/types.ts:1133-1140` — `sendUserMessage(...)` contract returns `void` and supports only `deliverAs?: "steer" | "followUp"`.
- `packages/coding-agent/src/core/extensions/loader.ts:221-228` — extension-facing `sendUserMessage` delegates and returns `void`.
- `packages/coding-agent/src/core/agent-session.ts:2159-2164` — runtime binding catches async `sendUserMessage` rejection and emits `send_user_message` errors.
- `packages/coding-agent/src/core/agent-session.ts:1292-1325` — async `sendUserMessage` implementation awaits `prompt(...)`.
- `packages/coding-agent/src/core/agent-session.ts:999-1021` — prompt preflight rejection examples.

**Exact omp-v2 source references:**
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts:185-195` — stagnation injection synchronous `try/catch` and immediate success reset.
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts:226-240` — restart injection synchronous `try/catch`, immediate success reset, and warning threshold.

## Finding R1-EXT-002 — Boulder swallows hook failures before host error observability can run

**Violated Invariant:** Hook failures must not crash the host, but they must be observable and must disable Boulder after repeated failures.

**Concrete counterexample path:**
1. The host runner already provides non-crashing observability for thrown hook errors: `packages/coding-agent/src/core/extensions/runner.ts:589-612` catches handler exceptions and calls `emitError({ extensionPath: ext.path, event: event.type, error, stack })`; `emitError` notifies registered error listeners at `packages/coding-agent/src/core/extensions/runner.ts:459-462`.
2. `agent_end` is a real host extension event with messages: `packages/coding-agent/src/core/agent-session.ts:612-618` emits `{ type: "agent_end", messages: event.messages }`, and `packages/coding-agent/src/core/extensions/types.ts:1040-1063` includes `agent_end` in `ExtensionAPI.on(...)` overloads.
3. Boulder wraps the whole `agent_end` body in `try { ... } catch { /* Hooks must never throw */ }` at `my-plugins/oh-my-pi-v2/hooks/boulder.ts:77-168`.
4. A concrete failure inside that body, such as `startCountdown(...)` throwing while calling UI status/input APIs from `my-plugins/oh-my-pi-v2/hooks/boulder-countdown.ts:37-48` or `:64-71`, is caught by Boulder’s local empty catch.
5. Because the exception is consumed inside the handler, it never reaches the host runner catch at `packages/coding-agent/src/core/extensions/runner.ts:589-612`; Boulder also does not increment any failure counter or disable itself in that catch.

**Runtime impact:** Boulder hook bugs or host API failures can disappear completely: no host extension error, no Boulder warning, no repeated-failure disable. Countdown/restart state can be left inconsistent, and continuation may stop or misfire without an observable causal signal.

**Severity:** High

**Exact package source references:**
- `packages/coding-agent/src/core/extensions/types.ts:1040-1063` — supported hook names include `agent_end`.
- `packages/coding-agent/src/core/agent-session.ts:612-618` — runtime emits `agent_end` with `messages` to the extension runner.
- `packages/coding-agent/src/core/extensions/runner.ts:459-462` — `emitError(...)` notifies extension error listeners.
- `packages/coding-agent/src/core/extensions/runner.ts:589-612` — generic hook dispatch catches thrown handler errors and reports them via `emitError(...)` without rethrowing.

**Exact omp-v2 source references:**
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts:77-168` — `agent_end` handler body is wrapped in an empty local catch.
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts:162-164` — countdown creation occurs inside the swallowed `agent_end` try block.
- `my-plugins/oh-my-pi-v2/hooks/boulder-countdown.ts:37-48` — visible countdown calls `ctx.ui.setStatus(...)`, interval cleanup, and terminal-input unsubscribe without local recovery.
- `my-plugins/oh-my-pi-v2/hooks/boulder-countdown.ts:64-71` — Esc handler calls `ctx.ui.notify(...)` without local recovery.
