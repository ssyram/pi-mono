# Round 1 Regression Sweep

Date: 2026-04-24

## Result: FAIL

Fresh source-level mini-audit found one contract/source-consistency regression introduced by Round 1's actionable-task fixes. Type compatibility is currently OK and the repository-level check passes, but two task-state consumers still gate on the older `pendingCount` semantics.

## Verification scope

Inspected required files only:

- `hooks/boulder.ts`
- `hooks/context-recovery.ts`
- `hooks/custom-compaction.ts`
- `tools/task.ts`
- `index.ts`

Also inspected changed task action source:

- `tools/task-actions.ts`

Permitted Round 1 context read:

- `docs/audit/Round1/round-context.md`

No prior audit/confirm reports were read.

## Command status

- `cd my-plugins/oh-my-pi-v2 && npm run check`: FAIL — package has no `check` script.
- `npm run check` from repository root: PASS.

Root check output completed successfully through:

- `biome check --write --error-on-warnings .`
- `tsgo --noEmit`
- `npm run check:browser-smoke`
- `packages/web-ui` checks (`biome` and `tsc`)

## Source consistency observations

### PASS: `getTaskState` producer exposes the new actionable contract

`tools/task.ts` now returns:

- `tasks`
- `pendingCount`
- `actionableCount`
- `inProgressCount`
- `readyTasks`

`readyTasks` are computed as `pending` tasks that are unblocked. `actionableCount` is computed as `inProgressCount + readyTasks.length`. This matches the Round 1 active-work contract: actionable work is `in_progress + ready/unblocked pending`, not all pending tasks.

### PASS: Boulder consumes actionable state, not stale pending state

`hooks/boulder.ts` uses `actionableCount` and `readyTasks` for restart decisions and restart message contents. Blocked pending tasks alone do not trigger Boulder continuation. The countdown re-check also re-fetches fresh task state and uses fresh `actionableCount`/`readyTasks` before injecting a restart.

Repeated Boulder injection failures are observable: failures are logged, active countdown is cancelled, Boulder is disabled after the configured threshold, and the UI is warned when available.

### PASS: task widget matches actionable-task state

`index.ts` computes active widget tasks as:

- `in_progress`, or
- `pending && isUnblocked(t, tasks)`

Blocked pending tasks are rendered separately as blocked and do not keep the task widget in the active state. The removed `/omp-stop` command is not registered in `index.ts`, and Boulder is no longer passed a persistent stop callback.

### PASS: task start API rejects invalid state transitions

`tools/task-actions.ts` now rejects `start` unless the task is currently `pending`, then separately checks whether it is unblocked. This prevents restarting already `in_progress`, `done`, or `expired` tasks through the `start` action.

## Hoare finding

### FAIL: Compaction/recovery consumers still use `pendingCount` as an active-work gate

**Files:**

- `hooks/context-recovery.ts`
- `hooks/custom-compaction.ts`

**Precondition expected by Round 1 contract:**

Task-state consumers that decide whether there is active/restorable task work should distinguish actionable work from merely blocked pending work.

Formally:

```text
P: task state may contain only blocked pending tasks, with no in_progress tasks and no readyTasks
```

**Observed implementation:**

Both consumers accept only a narrow task-state shape:

```ts
() => { tasks: Task[]; pendingCount: number }
```

They skip task restoration/context injection only when:

```ts
pendingCount === 0
```

They then render all tasks whose status is not `done` and not `expired`, which includes blocked pending tasks.

**Postcondition required by the new source contract:**

```text
Q: blocked pending tasks alone must not be treated as actionable active work
```

**Violation:**

Because `pendingCount` still counts both `pending` and `in_progress` tasks, a state containing only blocked pending tasks has `pendingCount > 0` but `actionableCount === 0`. `context-recovery.ts` and `custom-compaction.ts` will still inject/restore blocked pending tasks as active task context, while Boulder and the task widget correctly treat that same state as non-actionable.

**Impact:**

This is a source-level contract mismatch across `getTaskState` consumers. It does not currently break TypeScript because the broader producer return type is structurally assignable to the narrower consumer types, but behavior is inconsistent:

- Boulder: blocked pending only = no continuation.
- Task widget: blocked pending only = blocked display, no active count.
- Context recovery/custom compaction: blocked pending only = task context/restoration still emitted.

**Classification:** newly introduced/source-consistency regression from Round 1 contract migration. The producer and Boulder/widget consumers were moved to actionable-task semantics, but compaction/recovery consumers were left on `pendingCount` semantics.

**Suggested fix direction:**

Update `registerContextRecovery`, `registerCustomCompaction`, and `formatTaskContext` to consume `actionableCount` and/or `readyTasks`, and gate active task restoration on the same `in_progress + readyTasks` set used by Boulder. If blocked pending tasks should still be preserved for user visibility after compaction, label them explicitly as blocked rather than using `pendingCount` as the active-work predicate.
