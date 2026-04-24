# Round 3 Verification: Task Dependency Graph + Task-State Validation

## Scope

Verified only the requested Round 3 audit inputs and current task source files:

- `docs/audit/Round3/round-context.md`
- `docs/audit/Round3/candidates.md`
- `docs/audit/Round3/reduction.md`
- `tools/task-actions.ts`
- `tools/task-state-entry.ts`
- `tools/task-helpers.ts`

No source files were edited.

## Result Summary

| Candidate | Verdict | Fix expectation | Verification result |
| --- | --- | --- | --- |
| R3-C1 | PASS | Cycle detection must evaluate the final intended graph after removing stale reverse edges. | `executeUpdateDeps()` builds a proposed graph, removes stale reverse edges from old `task.blocks`, applies new relations, then runs BFS cycle detection. |
| R3-C2 | PASS | Persisted `blocks` / `blockedBy` mirrors must be reciprocal on reload. | `validateTaskStateEntryData()` rejects non-reciprocal dependencies through `hasReciprocalDependencies()`. |
| R3-C3 | PASS | Persisted timestamps must be finite nonnegative integers with coherent ordering. | `parseTask()` rejects invalid timestamps, and `isTimestamp()` requires finite nonnegative integers; `updatedAt < createdAt` is rejected. |

## Audit Context Evidence

- `docs/audit/Round3/round-context.md` establishes the active contract that task-state reload installs only strictly valid persisted task-state entries, and invalid persisted entries must not erase live memory.
- `docs/audit/Round3/candidates.md` identifies:
  - R3-C1: `executeUpdateDeps()` could reject an acyclic final graph if cycle detection was performed before stale reverse edges were removed.
  - R3-C2: `validateTaskStateEntryData()` could accept non-reciprocal `blocks` / `blockedBy` mirrors.
  - R3-C3: `parseTask()` only checked timestamp fields were numbers.
- `docs/audit/Round3/reduction.md` maps these to required fixes:
  - R3-RC1: build the proposed dependency graph from the final intended relation before cycle detection, and require persisted reciprocity.
  - R3-RC2: require finite nonnegative integer timestamps and `updatedAt >= createdAt`.

## R3-C1 — Dependency graph cycle detection

**Verdict: PASS**

Required behavior: `update_deps` cycle detection must remove stale reverse edges before checking for cycles, so rewrites are judged against the final intended graph rather than a transient graph containing old mirrors.

Source evidence from `tools/task-actions.ts`:

- `executeUpdateDeps()` computes `newBlocks` and `newBlockedBy`, validates missing/self references, then constructs `proposedBlockedBy` before mutating live task state.
- In the proposed graph cycle-detection block, it clones each task's `blockedBy` list, removes stale reverse edges for the current task's old `task.blocks`, overwrites the current task's dependencies with `newBlockedBy`, and adds proposed reverse edges for `newBlocks`.
- Only after those proposed final relations are installed does the BFS start from `proposedBlockedBy.get(task.id)` and reject if traversal reaches `task.id`.
- The live mutation block occurs after cycle detection passes and repeats the same final update shape: remove old reverse edges, assign `task.blocks` / `task.blockedBy`, then add new reverse edges.

Exact line evidence:

- `tools/task-actions.ts:115-148` — proposed graph construction and BFS cycle detection.
- `tools/task-actions.ts:124-127` — stale reverse edges are removed from the proposed graph for old `task.blocks` before BFS.
- `tools/task-actions.ts:128-132` — proposed current-task dependencies and new reverse edges are applied before BFS.
- `tools/task-actions.ts:136-146` — BFS rejects only if the proposed final graph reaches the original task id.
- `tools/task-actions.ts:150-170` — live state mutation happens after the cycle check and mirrors the final relation.

Conclusion: the Round 3 failure mode is fixed. Cycle detection no longer runs against a graph polluted by stale reverse edges.

## R3-C2 — Persisted reciprocity validation

**Verdict: PASS**

Required behavior: persisted task-state validation must reject dependency graphs where `blocks` and `blockedBy` do not mirror each other.

Source evidence from `tools/task-state-entry.ts`:

- `validateTaskStateEntryData()` validates parsed task shape, unique task ids, `nextId`, existing dependency references, reciprocal dependencies, and dependency cycles before returning task state.
- Non-reciprocal dependency mirrors return `undefined`, preventing invalid persisted state from being installed.
- `hasReciprocalDependencies()` checks both directions:
  - each `task.blocks` target must have the source task id in its `blockedBy` list;
  - each `task.blockedBy` blocker must have the source task id in its `blocks` list.

Exact line evidence:

- `tools/task-state-entry.ts:19-39` — full persisted task-state entry validation pipeline.
- `tools/task-state-entry.ts:35-37` — invalid dependency references, non-reciprocal dependencies, or dependency cycles return `undefined`.
- `tools/task-state-entry.ts:87-98` — reciprocal dependency enforcement for both `blocks` and `blockedBy` mirrors.
- `tools/task-state-entry.ts:100-115` — dependency-cycle rejection during persisted validation.

Cross-file relevance from `tools/task-helpers.ts`:

- `tools/task-helpers.ts:29-35` — `isUnblocked()` uses `blockedBy` to decide whether pending tasks are actionable.
- `tools/task-helpers.ts:40-46` — display status labels pending tasks `[ready]` versus `[blocked]` from that same relation.

Conclusion: persisted non-reciprocal mirrors are rejected before reload can make blocked work appear actionable.

## R3-C3 — Timestamp validation

**Verdict: PASS**

Required behavior: persisted task timestamps must be finite nonnegative integers, and ordering must be coherent (`updatedAt >= createdAt`).

Source evidence from `tools/task-state-entry.ts`:

- `parseTask()` rejects a task if either timestamp fails `isTimestamp()`.
- `parseTask()` also rejects tasks where `updatedAt < createdAt`.
- `isTimestamp()` requires the value to be a JavaScript number, finite, an integer, and greater than or equal to zero.

Exact line evidence:

- `tools/task-state-entry.ts:42-60` — individual task parsing and field validation.
- `tools/task-state-entry.ts:48` — timestamp validation and coherent ordering guard.
- `tools/task-state-entry.ts:70-75` — `isTimestamp()` requires `typeof value === "number"`, `Number.isFinite(value)`, `Number.isInteger(value)`, and `value >= 0`.

Cross-file relevance from `tools/task-helpers.ts`:

- `tools/task-helpers.ts:7-16` — the shared `Task` interface carries `createdAt` and `updatedAt` as numeric task fields used by task state.

Conclusion: persisted timestamps now satisfy the Round 3 requirement: finite, nonnegative, integer-valued, and coherently ordered.

## Final Verification

R3-C1, R3-C2, and R3-C3 all PASS against the requested current sources.
