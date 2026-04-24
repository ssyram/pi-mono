## R3-HOARE-001: `update_deps` can reject an acyclic dependency rewrite because cycle detection keeps stale reverse edges

- `{P}` Task `A` currently blocks task `B` (`A.blocks = [B]`, `B.blockedBy = [A]`). The user updates `A` so it no longer blocks `B` and is instead blocked by `B` (`blocks: []`, `blockedBy: [B]`). The resulting graph would be acyclic: `B -> A` only.
- `{S}` `executeUpdateDeps()` builds `proposedBlockedBy` from the current graph, replaces only `A.blockedBy`, and adds reverse edges for new `blocks` before checking for cycles; old reverse edges are removed only later during mutation.
- `{Q}` A dependency update whose final graph is acyclic should succeed.
- `{Actual}` The precheck still sees stale `B.blockedBy = [A]`, then adds/sets `A.blockedBy = [B]`, producing a temporary `A <-> B` cycle and returning `Cannot create circular dependency` even though the post-update graph would not contain that cycle.
- Evidence: `my-plugins/oh-my-pi-v2/tools/task-actions.ts:115-143` constructs the proposed cycle graph without removing old reverse edges; `my-plugins/oh-my-pi-v2/tools/task-actions.ts:145-165` removes old reverse edges only after the cycle check.

## R3-HOARE-002: persisted task-state validation accepts non-reciprocal dependency graphs

- `{P}` A persisted `omp-task-state` entry contains tasks with existing, non-self dependency ids and no `blockedBy` cycle, but `blocks` and `blockedBy` are not reciprocal mirrors, e.g. task `A.blocks = [B]` while task `B.blockedBy = []`.
- `{S}` `validateTaskStateEntryData()` validates task shape, unique ids, `nextId`, reference existence, and cycles using only `blockedBy` edges.
- `{Q}` Only strictly valid persisted task-state entries are installed; a valid task dependency graph must preserve the bidirectional invariant maintained by live `update_deps` mutations.
- `{Actual}` The entry passes validation and can be installed even though live readiness, blocked rendering, and cycle checks treat `blockedBy` as authoritative, leaving `blocks` inconsistent with the operational graph.
- Evidence: `my-plugins/oh-my-pi-v2/tools/task-state-entry.ts:19-38` has no reciprocity check; `my-plugins/oh-my-pi-v2/tools/task-state-entry.ts:73-80` checks only reference existence/self-reference; `my-plugins/oh-my-pi-v2/tools/task-state-entry.ts:82-97` detects cycles only through `blockedBy`.

## R3-HOARE-003: persisted task-state validation accepts invalid timestamp values

- `{P}` A persisted `omp-task-state` entry has otherwise valid tasks but uses impossible timestamps such as `createdAt: -1`, `updatedAt: 1.5`, or other non-epoch numeric values representable in persisted JSON.
- `{S}` `parseTask()` accepts a task when `createdAt` and `updatedAt` are merely `typeof number`.
- `{Q}` Only strictly valid persisted task-state entries are installed; task timestamps produced by the tool are finite epoch-millisecond values from `Date.now()` and should remain valid on reload.
- `{Actual}` Negative and fractional numeric timestamps pass validation and can be installed into live task memory.
- Evidence: `my-plugins/oh-my-pi-v2/tools/task-state-entry.ts:41-58` checks only the number type for `createdAt` and `updatedAt`; `my-plugins/oh-my-pi-v2/tools/task-actions.ts:36-45` and `my-plugins/oh-my-pi-v2/tools/task-actions.ts:50-87` create/update timestamps with `Date.now()`.

## R3-HOARE-004: task lifecycle shutdown cleanup can still propagate UI failures

- `{P}` During `session_shutdown`, the task widget cleanup path runs and `ctx.ui.setWidget("omp-tasks", undefined)` throws synchronously.
- `{S}` The `session_shutdown` handler in `index.ts` calls `ctx.ui.setWidget()` without a local `try/catch`.
- `{Q}` Boulder/context/task lifecycle hooks must not crash the host; local synchronous failures should be contained and observable where feasible.
- `{Actual}` The synchronous UI failure escapes the shutdown handler instead of being contained like the other task-widget update path.
- Evidence: `my-plugins/oh-my-pi-v2/index.ts:208-212` lacks local crash containment for shutdown widget cleanup; `my-plugins/oh-my-pi-v2/index.ts:57-121` shows the same task-widget update surface is otherwise wrapped and logged.

## R3-HOARE-005: deployment documentation omits the required actionable-task and command semantics

- `{P}` A local user follows the non-audit deployment documentation as the installed omp-v2 operational reference.
- `{S}` `docs/deployment-guide.md` documents installation, required/recommended extensions, symlinks, and verification steps.
- `{Q}` Non-audit docs describe the current command set and actionable-task semantics, including that Boulder/task continuation is driven by `in_progress` plus ready/unblocked `pending` tasks and not blocked pending tasks alone.
- `{Actual}` The deployment guide contains no actionable-task definition and no current command-set semantics; the README has this information, but the deployment doc does not.
- Evidence: `my-plugins/oh-my-pi-v2/README.md:9-15` documents actionable-task semantics and current commands; `my-plugins/oh-my-pi-v2/docs/deployment-guide.md:3-151` covers dependency/install/verification content without the actionable-task or command semantics.
