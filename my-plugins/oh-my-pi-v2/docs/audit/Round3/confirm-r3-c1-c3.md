# Round 3 Independent Confirmation: R3-C1 through R3-C3

Scope: independent confirmation of `my-plugins/oh-my-pi-v2/docs/audit/Round3/candidates.md` candidates R3-C1, R3-C2, and R3-C3 against current source only.

## R3-C1: `update_deps` can reject a valid final acyclic dependency rewrite

Verdict: CONFIRMED

### Source evidence

- `tools/task-actions.ts:93-103` resolves the target task and computes proposed direct arrays:
  - `const newBlocks = params.blocks ?? task.blocks;`
  - `const newBlockedBy = params.blockedBy ?? task.blockedBy;`
- `tools/task-actions.ts:115-143` performs the cycle precheck before mutation. The proposed graph is initialized with `newBlockedBy` only for the target task and current `blockedBy` for every other task:
  - `proposedBlockedBy.set(t.id, t.id === task.id ? [...newBlockedBy] : [...t.blockedBy]);`
  - the BFS then returns `err("update_deps", \`circular dependency detected involving #${task.id}\`, tasks, nextId)` if it reaches the target.
- `tools/task-actions.ts:145-153` removes stale reverse edges only after that precheck:
  - old `task.blocks` reverse links are removed from other tasks' `blockedBy` arrays.
  - old `task.blockedBy` reverse links are removed from other tasks' `blocks` arrays.
- `tools/task-actions.ts:154-165` installs new direct and reciprocal edges after stale-edge removal.

### Minimal trigger / rationale

If task A currently blocks task B (`A.blocks = [B]`, `B.blockedBy = [A]`) and the user rewrites A to `blocks: []`, `blockedBy: [B]`, the final intended graph is only `B -> A` and is acyclic. Current precheck still keeps non-target B's existing `blockedBy = [A]` while setting A's `blockedBy = [B]`, temporarily seeing `A <- B <- A`; it can reject before the later stale reverse-edge removal runs.

## R3-C2: persisted task dependency mirrors are not validated for reciprocity

Verdict: CONFIRMED

### Source evidence

- `tools/task-state-entry.ts:19-38` validates persisted task-state shape, `nextId`, duplicate IDs, max ID, dependency references, and cycles, then returns `{ tasks, nextId }`. There is no reciprocity/mirror check between `blocks` and `blockedBy` in this validation sequence.
- `tools/task-state-entry.ts:73-79` validates dependency references by iterating combined `task.blocks` and `task.blockedBy`; it rejects self-references and missing IDs, but does not require that `A.blocks` containing B is mirrored by `B.blockedBy` containing A, or vice versa.
- `tools/task-state-entry.ts:82-97` detects cycles using a map from task ID to `task.blockedBy` and traverses only `blockedBy` chains.
- `tools/task-helpers.ts:32-38` determines unblocked/readiness solely from `task.blockedBy`.
- `tools/task-helpers.ts:43-49` renders pending tasks as `[ready]` when `isUnblocked()` is true, and `tools/task-helpers.ts:80-85` displays blockers from `t.blockedBy`.

### Minimal trigger / rationale

A persisted entry with two pending tasks A and B, where `A.blocks = [B]` but `B.blockedBy = []`, has existing integer dependency IDs and no `blockedBy` cycle. Current validation accepts the arrays independently, while operational readiness uses B's empty `blockedBy`; B can therefore appear/action as ready despite A's `blocks` mirror saying A blocks B.

## R3-C3: persisted task timestamps accept invalid numeric values

Verdict: CONFIRMED

### Source evidence

- `tools/task-state-entry.ts:41-58` parses each task. For timestamps it checks only:
  - `if (typeof value.createdAt !== "number" || typeof value.updatedAt !== "number") return undefined;`
  - then returns `createdAt: value.createdAt` and `updatedAt: value.updatedAt` unchanged.
- No finite, integer, nonnegative, or epoch-millisecond validation appears in the task-state parser/validator path shown in `tools/task-state-entry.ts:19-58`.

### Minimal trigger / rationale

A persisted task with otherwise valid fields but numeric impossible timestamps such as `createdAt: -1` or `updatedAt: 1.5` passes the current timestamp type check because both values are JavaScript numbers. The candidate is confirmed for invalid numeric values; JSON persistence cannot represent `NaN`/`Infinity`, but negative or fractional numbers are sufficient triggers.
