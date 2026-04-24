# R3-C13 rerun 2 verification

Verdict: PASS

R3-C13 is now resolved. The current source and non-audit docs consistently describe Boulder continuation in active/actionable terms: actionable work is `in_progress` tasks plus ready/unblocked `pending` tasks. The previously failing broad/incomplete wording in `hooks/boulder.ts` has been cleaned up.

## Audit context used

Read only the permitted Round 3 audit files:

- `docs/audit/Round3/round-context.md`
- `docs/audit/Round3/candidates.md`
- `docs/audit/Round3/reduction.md`
- `docs/audit/Round3/verify-rerun-r3-c13.md`

Relevant criterion from that context: Boulder-related continuation must be based on active/actionable work (`in_progress` + ready/unblocked `pending`), and blocked `pending` tasks alone must not trigger Boulder continuation, active prompt injection, compaction task context, or context-restoration continuation.

## Source evidence

### `hooks/boulder.ts`

- `hooks/boulder.ts:2-6` now uses actionable/active-ready wording in the file header:
  - `* Auto-restart hook that keeps agents working while actionable tasks remain.`
  - `* If the model stops while there is still active/ready work, injects a follow-up prompt.`
- `hooks/boulder.ts:94-99` gates restart behavior on actionable state:
  - `const { tasks, actionableCount, readyTasks } = await getTaskState(pi);`
  - `if (actionableCount === 0) { return; }`
- `hooks/boulder.ts:162-167` re-checks actionable state before firing the countdown restart:
  - `const fresh = await getTaskState(pi);`
  - `if (fresh.actionableCount === 0) { return; }`
  - `const message = buildRestartMessage(fresh.tasks, fresh.readyTasks, fresh.actionableCount);`
- `hooks/boulder.ts:181-185` defines actionable tasks exactly as active plus ready work:
  - `const activeTasks = tasks.filter((t) => t.status === "in_progress");`
  - `return [...activeTasks, ...readyTasks];`
- `hooks/boulder.ts:213-216` uses actionable wording for stagnation stop:
  - `"Stopping Boulder auto-restarts because the same actionable tasks remain unchanged after repeated attempts."`
- `hooks/boulder.ts:236-253` builds the restart prompt from actionable inputs and now uses active/ready wording:
  - function parameters include `readyTasks` and `actionableCount`
  - headline: `"You have active/ready work remaining:"`

This resolves the prior failing `hooks/boulder.ts` phrases:

- Prior `"the outstanding tasks"` header wording is now `"actionable tasks remaining"` / `"active/ready work"`.
- Prior `"active/ready tasks that are not finished"` prompt wording is now `"You have active/ready work remaining:"`.

### `hooks/boulder-countdown.ts`

- `hooks/boulder-countdown.ts:19-25` documents the countdown count as actionable:
  - `* @param actionable Number of actionable tasks.`
- `hooks/boulder-countdown.ts:37-41` displays actionable task count to the user:
  - ``Restarting in ${remaining}s (${actionable} actionable tasks) — press Esc to cancel``
- `hooks/boulder-countdown.ts:63-68` cancellation message is task-neutral:
  - `Task restart cancelled.`

The remaining phrase `pending restart` at `hooks/boulder-countdown.ts:5` describes the restart event being cancelled, not pending-task semantics.

### `hooks/context-recovery.ts`

- `hooks/context-recovery.ts:26-29` obtains actionable task state:
  - `getTaskState: () => Promise<{ tasks: Task[]; actionableCount: number; readyTasks: Task[] }>;`
- `hooks/context-recovery.ts:99-107` restores only actionable task context after compaction:
  - returns early when `actionableCount === 0`
  - builds task lines from `in_progress` tasks plus `readyTasks`
  - labels restored work as `Active tasks:`

### `README.md`

- `README.md:11` documents Boulder as actionable-only:
  - `auto-restarts the agent when actionable tasks remain (\`in_progress\` or ready/unblocked \`pending\`)`
- `README.md:14` lists the current command set only:
  - `/omp-start`, `/omp-consult`, `/omp-review`
- `README.md:93` labels `hooks/boulder.ts` as:
  - `Auto-restart on actionable tasks`

### `docs/deployment-guide.md`

- `docs/deployment-guide.md:21-22` explicitly documents actionable semantics and blocked-pending exclusion:
  - Boulder auto-runs only for actionable tasks: `in_progress` plus ready/unblocked `pending`.
  - Blocked `pending` alone does not trigger Boulder continuation, active prompt injection, compaction task context, or post-compaction recovery prompt.
- `docs/deployment-guide.md:23-24` documents current cancellation/command behavior:
  - Esc cancels only the current Boulder countdown.
  - Current commands are `/omp-start`, `/omp-consult`, `/omp-review`; there is no `/omp-stop`.

## Stale wording search

Command run from `my-plugins/oh-my-pi-v2`:

```sh
rg -n --glob '!docs/audit/**' -e 'pending tasks|tasks still pending|incomplete|not complete|not finished|outstanding tasks|pending' hooks/boulder.ts hooks/boulder-countdown.ts hooks/context-recovery.ts README.md docs/deployment-guide.md
```

Output:

```text
docs/deployment-guide.md:21:- Boulder 只会在存在 **actionable tasks** 时自动续跑：`in_progress` 任务 + ready/unblocked 的 `pending` 任务。
docs/deployment-guide.md:22:- 只有 blocked `pending` 任务时不会触发 Boulder 续跑、active prompt 注入、compaction task context 或 compaction 后恢复提示。
hooks/boulder-countdown.ts:5: * at any time during the countdown to cancel the pending restart.
README.md:11:- **Boulder loop** — auto-restarts the agent when actionable tasks remain (`in_progress` or ready/unblocked `pending`)
hooks/boulder.ts:31:  pendingCount: number;
```

Interpretation:

- `docs/deployment-guide.md:21`, `docs/deployment-guide.md:22`, and `README.md:11` are correct scoped references to ready/unblocked or blocked `pending` task semantics.
- `hooks/boulder-countdown.ts:5` refers to a pending restart event, not pending tasks.
- `hooks/boulder.ts:31` is an internal field name, not user-facing stale Boulder wording.
- The stale patterns `pending tasks`, `tasks still pending`, `incomplete`, `not complete`, `not finished`, and `outstanding tasks` produced no failing source/doc hits outside `docs/audit`.

## Conclusion

PASS. Current source and non-audit docs now use active/ready/actionable semantics for Boulder wording. The prior R3-C13 failure evidence in `hooks/boulder.ts` has been corrected, and the remaining `pending` matches are either correct scoped task-state documentation, an internal field name, or a restart-event phrase rather than stale pending-task wording.
