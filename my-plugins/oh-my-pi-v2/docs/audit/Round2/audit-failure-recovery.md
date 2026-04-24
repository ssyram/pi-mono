# Round 2 Failure/Recovery Audit Findings

## Finding 1 — Mutating task actions can leave unpersisted in-memory state after a persistence failure

**Hoare triple**

- `{ tasks == last persisted task state }`
- `C: task.execute(mutating action) where pi.appendEntry(...) throws synchronously`
- `{ tasks == last persisted task state AND the caller sees the persistence failure }`

**Actual:** the caller sees the persistence failure, but `tasks` may already be mutated.

**Evidence**

- `tools/task.ts:134-160` dispatches mutating actions, then calls `persistState()`; on failure it logs and rethrows, but does not roll back in-memory state.
- `tools/task.ts:148` handles `clear` by assigning `tasks = []; nextId = 1` before persistence.
- `tools/task-actions.ts:36-44` pushes new tasks before persistence.
- `tools/task-actions.ts:50-65` changes a pending task to `in_progress` before persistence.
- `tools/task-actions.ts:71-87` changes tasks to terminal states before persistence.
- `tools/task-actions.ts:145-165` mutates dependency edges across multiple task objects before persistence.
- `packages/coding-agent/src/core/extensions/types.ts:1142-1143` and `loader.ts:230-231` expose `appendEntry(...)` as `void`, so async persistence completion cannot be awaited, but synchronous throws are locally catchable.

**Failure mode:** after a synchronous append failure, Boulder, prompt injection, context recovery, and the widget can observe the mutated in-memory state even though the session log does not contain it. On reload, state snaps back to the previous persisted entry. This creates task-state drift and can cause incorrect continuation or missed continuation until reload.

**Local fix direction:** stage mutations into a cloned task state, call `appendEntry` for the staged state, and commit `tasks/nextId` only after the synchronous append call returns; or snapshot and roll back in the catch. This only addresses local synchronous failures and does not claim to solve the host's void async persistence boundary.

## Finding 2 — Reload accepts malformed persisted task arrays and can replace healthy memory with invalid state

**Hoare triple**

- `{ current in-memory tasks are valid AND session contains a malformed omp-task-state entry }`
- `C: reloadState(ctx)`
- `{ malformed persisted state is rejected OR current valid memory is preserved }`

**Actual:** a minimally shaped entry replaces current memory if `data.tasks` is an array and `data.nextId` is a number.

**Evidence**

- `tools/task.ts:65-73` validates only `customType === "omp-task-state"`, `Array.isArray(data.tasks)`, and numeric `nextId`.
- `tools/task.ts:76-86` assigns `tasks = loadedTasks; nextId = loadedNextId` after selecting the last minimally valid entry.
- `tools/task-helpers.ts:32-38` assumes each task has a `blockedBy` array and treats missing dependency IDs as satisfied.

**Failure mode:** a corrupt, old-version, or user-edited custom entry can load tasks with missing arrays, invalid statuses, duplicate IDs, or broken dependency edges. Downstream recovery paths can then misclassify blocked work as ready, throw while computing readiness, or inject/continue from invalid task state. Because the invalid entry is accepted as the latest state, this is a reload recovery bug rather than a host API limitation.

**Local fix direction:** add full task-state validation before assignment: valid status enum, numeric unique IDs, string text, array `blocks/blockedBy`, valid dependency references, no self/cycles, sane timestamps, and `nextId > max(id)`. If validation fails, log the bad entry and preserve the previous in-memory state.

## Finding 3 — Context auto-compaction latches the session before a local compact failure is known

**Hoare triple**

- `{ usage.percent >= AUTO_COMPACT_THRESHOLD AND sessionId not in compactedSessions }`
- `C: before_agent_start context-recovery handler where ctx.compact() throws synchronously`
- `{ failure is observable AND session remains eligible for a later auto-compaction retry }`

**Actual:** the failure is swallowed and the session remains latched as compacted.

**Evidence**

- `hooks/context-recovery.ts:41-48` calls `compactedSessions.add(sessionId)` before `ctx.compact()`.
- `hooks/context-recovery.ts:76-78` catches all errors with only `return undefined` and no logging or rollback.
- `packages/coding-agent/src/core/extensions/types.ts:311-312` exposes `compact(options?): void`, so async completion cannot be awaited, but synchronous throws are locally catchable.

**Failure mode:** if the local `ctx.compact()` call throws before scheduling compaction, no `session_compact` event fires to clear the latch. Future `before_agent_start` calls skip auto-compaction for that session because `compactedSessions` already contains it, so context recovery silently stops trying at the high-water mark.

**Local fix direction:** move `compactedSessions.add(sessionId)` after the synchronous `ctx.compact()` call returns, or delete the latch in the catch. Log the synchronous failure. This does not depend on observing async compaction success.

## Finding 4 — Post-compaction task-restoration send failures are swallowed without diagnostics

**Hoare triple**

- `{ session_compact event AND actionableCount > 0 }`
- `C: pi.sendUserMessage(restoration message, { deliverAs: "followUp" }) throws synchronously`
- `{ task-restoration failure is observable and contained }`

**Actual:** the failure is contained but not observable.

**Evidence**

- `hooks/context-recovery.ts:92-102` builds the active-task restoration message from `in_progress` tasks plus `readyTasks` and sends it with `pi.sendUserMessage(...)`.
- `hooks/context-recovery.ts:103-105` catches all errors with only `// Hooks must never throw`.
- `packages/coding-agent/src/core/extensions/types.ts:1137-1140` and `loader.ts:226-227` show `sendUserMessage(...)` is `void`, so async delivery failure is a known API boundary. This finding is only about synchronous throws, which the local catch already intercepts.

**Failure mode:** a synchronous local send error causes the post-compaction active-task reminder to disappear silently. The user and logs get no signal that restoration failed, even though active tasks still exist.

**Local fix direction:** log synchronous failures with enough context (`sessionId`, `actionableCount`) and optionally surface a best-effort UI warning guarded by its own catch.

## Finding 5 — Custom compaction UI-status cleanup can turn fallback paths into handler errors

**Hoare triple**

- `{ session_before_compact hook starts OR custom compaction fallback catch is executing }`
- `C: ctx.ui.setStatus("omp-compact", ...) throws synchronously`
- `{ UI-status failure is contained and does not prevent fallback/obscure the original compaction failure }`

**Actual:** some status calls are outside the protection needed for that invariant.

**Evidence**

- `hooks/custom-compaction.ts:213` calls `ctx.ui.setStatus("omp-compact", "⚡ Compacting (oh-my-pi)...")` before the `try` begins at `hooks/custom-compaction.ts:215`.
- `hooks/custom-compaction.ts:308-311` catches a custom-compaction error, logs it, then calls `ctx.ui.setStatus("omp-compact", undefined)` without a nested guard before returning the built-in fallback.
- `packages/coding-agent/src/core/extensions/types.ts:119-156` exposes `setStatus(...)` as `void`; synchronous exceptions are locally catchable, while async UI delivery is not observable.

**Failure mode:** a synchronous UI-status failure at hook start aborts the custom compaction handler before its fallback logic runs. A synchronous UI-status failure inside the catch can replace a handled compaction fallback with a new handler error and may leave stale UI status. The extension runner reports thrown handler errors, but the plugin-local recovery path is still broken.

**Local fix direction:** move the initial status update inside the main `try`, and wrap cleanup status calls in small best-effort helpers that catch/log their own failures without replacing the original fallback outcome.
