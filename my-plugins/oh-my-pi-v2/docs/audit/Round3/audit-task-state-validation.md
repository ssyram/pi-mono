# Round 3 Audit: Task-State Validation Completeness and Rollback Semantics

## Finding 1 — Persisted dependency mirrors are not validated, allowing corrupted task graphs to become active state

**Hoare triple**

`{ persisted omp-task-state entry contains two pending tasks A and B where A.blocks = [B.id] but B.blockedBy = [] }`

`reloadState(ctx)`

`{ in-memory task state accepts the entry; getTaskState() can report B as ready/actionable even though the persisted graph also says A blocks B }`

**Why this is concrete**

- `validateTaskStateEntryData()` validates task shape, duplicate task ids, `nextId`, dependency existence/self-reference, and cycles, but does not require `blocks` and `blockedBy` to be reciprocal.
- `isUnblocked()` and therefore `getTaskState().readyTasks` decide readiness from `task.blockedBy`, not from other tasks' `blocks` arrays.
- `reloadState()` installs the last valid parsed entry into memory. Because the non-reciprocal graph passes validation, it becomes live runtime state.
- Boulder continuation, active prompt injection, context recovery, and custom compaction consume `getTaskState()` / ready tasks as active work, so the corrupted persisted graph can cause a blocked pending task to be treated as actionable.

**Relevant code paths**

- `tools/task-state-entry.ts`: validation checks dependency ids and cycles but not mirror consistency between `blocks` and `blockedBy`.
- `tools/task-helpers.ts`: `isUnblocked()` uses only a task's `blockedBy` dependencies.
- `tools/task.ts`: `reloadState()` installs validated persisted entries; `getTaskState()` computes `readyTasks`; active injection uses `in_progress` plus unblocked pending tasks.
- Consumers: `hooks/boulder.ts`, `hooks/context-recovery.ts`, `hooks/custom-compaction.ts`, and `index.ts` all treat `in_progress + readyTasks` as active/actionable work.

**Impact**

A corrupted but accepted persisted entry can revive blocked work as actionable after reload. This violates the Round 3 hardening goal that only strictly valid persisted task-state entries are installed.

## Non-findings

- Invalid persisted task-state entries do not erase live memory: `reloadState()` ignores invalid entries and returns without changing memory when no valid entry exists.
- A newer invalid entry does not overwrite the last valid state during reload; invalid entries are skipped.
- Mutating task actions roll back `tasks` and `nextId` if synchronous `pi.appendEntry()` persistence throws, and `notifyChange()` is reached only after successful persistence.
- `task.start` only transitions pending, unblocked tasks to `in_progress`; terminal tasks are not resurrected by `start`.
