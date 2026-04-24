# Round 2 Confirmation: R2-C7 / R2-C8

Scope constraints followed for the verdicts below: source inspection plus `docs/audit/Round2/round-context.md` only. The conclusions are based on the runtime paths in `hooks/context-recovery.ts` and `hooks/custom-compaction.ts`.

## R2-C7 — context post-compaction task-restoration synchronous send failures are silent

**Verdict: CONFIRMED.**

### Runtime path

1. `hooks/context-recovery.ts:83-107` registers a `session_compact` hook for post-compaction restoration.
2. Inside the hook, the code enters a `try` block, clears per-session compaction/warning tracking, then reads the current task state via `getTaskState()`.
3. If there is actionable task state, it formats active tasks and calls:

   ```ts
   pi.sendUserMessage(
     `## Context Restored After Compaction\n\nActive tasks:\n${taskLines}\n\nPlease continue working on these tasks.`,
     { deliverAs: "followUp" },
   );
   ```

4. The surrounding handler catches all thrown errors with:

   ```ts
   } catch {
     // Hooks must never throw
   }
   ```

### Failure observability assessment

A synchronous exception thrown by `pi.sendUserMessage(...)` on this path is caught by the empty `catch` and is not logged, surfaced to UI, recorded as diagnostics, or otherwise made observable locally.

The Round 2 context distinguishes async prompt delivery failures from local source bugs because `sendUserMessage(...): void` prevents awaiting host delivery failures. This confirmation is narrower: it concerns only a synchronous exception thrown at the local `pi.sendUserMessage` callsite. That synchronous failure is locally catchable and is currently swallowed silently.

### Strict conclusion

R2-C7 is confirmed for **local synchronous** `sendUserMessage` failures in post-compaction task restoration. It is **not** confirmed for asynchronous host delivery failures after `sendUserMessage` returns, because the round context classifies that as an API/host limitation unless a deterministic local workaround exists.

## R2-C8 — custom compaction UI status failures can break fallback/error paths

**Verdict: CONFIRMED.**

### Runtime path A: initial status failure before fallback protection

1. `hooks/custom-compaction.ts:210-215` registers a `session_before_compact` handler.
2. The first operation in the handler is:

   ```ts
   ctx.ui.setStatus("omp-compact", "⚡ Compacting (oh-my-pi)...");
   ```

3. The `try` block starts only after that call.

A synchronous exception from this initial `ctx.ui.setStatus(...)` occurs before the handler reaches its `try`/`catch`. That prevents the custom compaction handler from reaching its explicit fallback/error paths, including the intended `return undefined` fallback to built-in compaction.

### Runtime path B: fallback status-clear failure prevents fallback return

Several fallback branches clear the UI status before returning `undefined`:

- `hooks/custom-compaction.ts:217-220`: missing `ctx.model` branch logs fallback, clears status, then returns `undefined`.
- `hooks/custom-compaction.ts:223-227`: authentication failure branch logs fallback, clears status, then returns `undefined`.
- `hooks/custom-compaction.ts:287-290`: empty-summary branch logs fallback, clears status, then returns `undefined`.
- `hooks/custom-compaction.ts:308-311`: catch block logs the compaction error, clears status, then returns `undefined`.

In each case, `ctx.ui.setStatus("omp-compact", undefined)` is executed before the fallback return. If that status-clear call throws synchronously, the adjacent `return undefined` is not reached. The catch block also does not wrap its own status-clear call in a nested guard, so an error-path status failure can escape the intended fallback path.

### Failure robustness assessment

The custom compaction fallback contract depends on returning `undefined` so built-in compaction can proceed. Current UI status calls are treated as non-failing operations even though they sit directly before or inside fallback/error paths. A synchronous UI status failure can therefore replace a safe fallback with a thrown hook failure.

### Strict conclusion

R2-C8 is confirmed for synchronous `ctx.ui.setStatus(...)` failures. The initial status set can fail before the handler's local error handling starts, and status-clear failures inside fallback/catch branches can prevent the intended `return undefined` fallback from executing.
