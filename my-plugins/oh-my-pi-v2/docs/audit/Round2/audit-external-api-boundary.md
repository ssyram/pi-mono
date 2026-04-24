# Round 2 Audit: External API Limitation Boundary

Scope: `my-plugins/oh-my-pi-v2` against the local `packages/coding-agent` extension API. This audit separates non-decisional local issues from host/API limitations that require an architectural decision outside omp-v2.

## Hoare Findings

### H1 — Context recovery swallows local hook failures without observability

- **Kind:** local non-decisional issue
- **Evidence:** `my-plugins/oh-my-pi-v2/hooks/context-recovery.ts:76-79`, `103-105`, and `117-119` catch errors and return/continue with only a “Hooks must never throw” comment.
- **Boundary analysis:** The host already provides an extension error channel for runner-caught hook failures (`packages/coding-agent/src/core/extensions/runner.ts:597-616`, `649-657`) and interactive mode renders those errors (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:1494-1495`, `2253-2265`). These local catches prevent the host channel from seeing the failures and also do not log or notify.
- **Consequence:** Context compaction warnings, compaction-triggered continuation, or shutdown cleanup can fail silently, reducing auditability of Boulder/context recovery behavior.
- **Local fix remains:** Replace empty catches with non-throwing observability, e.g. `console.error(...)` and, where a UI context is available, best-effort `ctx.ui.notify(..., "warning")` guarded by its own catch.

### H2 — Edit-error recovery swallows local hook failures without observability

- **Kind:** local non-decisional issue
- **Evidence:** `my-plugins/oh-my-pi-v2/hooks/edit-error-recovery.ts:60-96` wraps the `tool_result` hook and the catch at `93-96` returns `undefined` with only a “Hooks must never throw” comment.
- **Boundary analysis:** `tool_result` handler failures are host-reportable when allowed to reach the runner (`packages/coding-agent/src/core/extensions/runner.ts:649-657`). This local catch bypasses that reporting and provides no replacement log/UI signal.
- **Consequence:** If recovery-hint generation fails, the user sees only the original edit failure and no indication that omp-v2’s recovery hook failed.
- **Local fix remains:** Add non-throwing observability in the catch, at minimum `console.error(...)`; if the hook context exposes UI safely, add best-effort warning notification.

## Limitations / Decisional Host API Boundaries

### L1 — `sendUserMessage` delivery confirmation is not awaitable by extensions

- **Evidence:** The extension-facing API returns `void` (`packages/coding-agent/src/core/extensions/loader.ts:226-228`), while the internal session method is async (`packages/coding-agent/src/core/agent-session.ts:1294-1297`). The runtime binding catches async delivery failures and emits an extension error event (`packages/coding-agent/src/core/agent-session.ts:2159-2166`) rather than returning a promise/result to the caller.
- **Current omp-v2 usage:** Boulder and context recovery call `pi.sendUserMessage(...)` without awaiting because no awaitable contract exists (`hooks/boulder.ts:221`, `223`, `263`, `265`; `hooks/context-recovery.ts:99`). Commands also use bare sends (`commands/start-work.ts:234`, `252`, `313`; `commands/consult.ts:74`; `commands/review-plan.ts:143`).
- **Boundary:** omp-v2 can catch only synchronous throws at the callsite. Deterministic knowledge of async prompt delivery success/failure requires a host API change such as returning `Promise<void>`/a result, or providing a caller-correlatable completion/error callback.
- **Local bug?** No, not beyond local observability around synchronous catches. Repeating this as a local Boulder bug would be incorrect under the current extension contract.

### L2 — `appendEntry` persistence/id observability is hidden by the extension boundary

- **Evidence:** The extension-facing `appendEntry(customType, data): void` delegates to runtime (`packages/coding-agent/src/core/extensions/loader.ts:230-231`). Runtime delegates to `this.sessionManager.appendCustomEntry(customType, data)` without returning the internal result (`packages/coding-agent/src/core/agent-session.ts:2168-2169`). Internally, `appendCustomEntry(...)` returns an entry id (`packages/coding-agent/src/core/session-manager.ts:897-907`).
- **Current omp-v2 usage:** Task persistence calls `pi.appendEntry(TASK_ENTRY_TYPE, { tasks: [...tasks], nextId })` (`my-plugins/oh-my-pi-v2/tools/task.ts:89`) and notifies task changes only after the call returns (`task.ts:97-116` shows prompt injection policy; the persistence/notification ordering is in the same tool implementation).
- **Boundary:** Because extension `appendEntry` is `void`, omp-v2 cannot record the persisted custom-entry id or distinguish a successful persisted append from any host-level semantic that does not surface a result. The internal session manager mutates in-memory session state before persistence (`packages/coding-agent/src/core/session-manager.ts:821-825`), which is also a host semantic decision.
- **Local bug?** No additional local non-decisional fix was found for the extension API boundary. Changing persistence acknowledgement/id semantics belongs to the host API.

### L3 — UI notify/status/widget APIs are fire-and-forget

- **Evidence:** `ExtensionUIContext.notify(...)`, `setStatus(...)`, and `setWidget(...)` are `void` methods (`packages/coding-agent/src/core/extensions/types.ts:130`, `136`, `155`). Interactive mode maps them directly to UI actions (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:1865-1885`).
- **Current omp-v2 usage:** Boulder warnings, countdown status, compaction status, task widgets, and command notices use these fire-and-forget UI calls (`hooks/boulder.ts:190`; `hooks/boulder-countdown.ts:38`, `47`, `67`; `hooks/custom-compaction.ts:213`, `219`, `226`, `289`, `299`, `310`; `index.ts:210`; command notify callsites in `commands/start-work.ts`, `commands/consult.ts`, and `commands/review-plan.ts`).
- **Boundary:** omp-v2 cannot await UI render/acknowledgement or receive delivery failures for these UI operations. Best-effort local try/catch/logging is possible for synchronous failures only; stronger guarantees require a host API decision.
- **Local bug?** No local non-decisional fix was found solely from the void UI contract. Existing Boulder failure warning already catches/logs notification failure (`hooks/boulder.ts:188-204`).

### L4 — Host hook error reporting exists, but only for failures that reach the runner

- **Evidence:** `ExtensionRunner.emitError(...)` dispatches structured errors to listeners (`packages/coding-agent/src/core/extensions/runner.ts:454-462`). General event and `tool_result` handler failures are caught and reported (`runner.ts:597-616`, `649-657`), and interactive mode displays them (`interactive-mode.ts:1494-1495`, `2253-2265`).
- **Boundary:** This is sufficient for host-observed hook failures, but local code that catches and swallows errors must provide its own observability. The local findings above are therefore source bugs, not host limitations.

## Final Separation

- **Local non-decisional fixes remaining:** H1 and H2 only.
- **Decisional host/API limitations:** L1 (`sendUserMessage` awaitability/correlation), L2 (`appendEntry` result/persistence acknowledgement), L3 (UI notify/status/widget acknowledgement), and the general boundary in L4.
