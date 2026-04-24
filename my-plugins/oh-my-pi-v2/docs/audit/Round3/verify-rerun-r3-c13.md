# R3-C13 Rerun Verification

Result: FAIL

## Scope

Allowed audit context read:
- `docs/audit/Round3/round-context.md`
- `docs/audit/Round3/candidates.md`
- `docs/audit/Round3/reduction.md`
- `docs/audit/Round3/verify-doc-wording.md`

Current files inspected:
- `hooks/boulder.ts`
- `hooks/boulder-countdown.ts`
- `hooks/context-recovery.ts`
- `README.md`
- `docs/deployment-guide.md`

## Baseline from Round 3 audit context

R3-C13 is about stale Boulder wording that describes actionable task continuation as broad pending/incomplete work. The Round 3 baseline is that actionable work is:

- `in_progress` tasks
- plus ready/unblocked `pending` tasks

Blocked `pending` tasks alone must not trigger Boulder continuation, active prompt injection, compaction task context, or context-restoration continuation.

The previous `verify-doc-wording.md` run failed R3-C13 because wording in `hooks/boulder.ts` still used stale pending/incomplete-style phrasing even though source behavior already used actionable-task semantics.

## Current source evidence

### Correct actionable-task behavior is present

`hooks/boulder.ts` gates Boulder restart on `actionableCount`:

- `hooks/boulder.ts:94-99` returns early when `actionableCount === 0`.
- `hooks/boulder.ts:181-185` defines actionable tasks as `in_progress` tasks plus `readyTasks`.

`hooks/context-recovery.ts` uses the same actionable semantics:

- `hooks/context-recovery.ts:26-29` receives `actionableCount` and `readyTasks` from task state.
- `hooks/context-recovery.ts:99-107` returns early when `actionableCount === 0`, then restores only `in_progress` tasks plus `readyTasks` under `Active tasks:`.

### Corrected wording is present in several places

`hooks/boulder.ts` user-facing stagnation wording now says actionable tasks:

- `hooks/boulder.ts:213-216` says `${actionableCount} actionable tasks remain`.

`hooks/boulder-countdown.ts` countdown UI now says actionable tasks:

- `hooks/boulder-countdown.ts:24` documents `actionable` as `Number of actionable tasks`.
- `hooks/boulder-countdown.ts:40` displays `Restarting in ${remaining}s (${actionable} actionable tasks) — press Esc to cancel`.
- `hooks/boulder-countdown.ts:67` says `Task restart cancelled.`

`README.md` describes current actionable semantics:

- `README.md:11` says Boulder auto-restarts when actionable tasks remain: `in_progress` or ready/unblocked `pending`.
- `README.md:93` describes `hooks/boulder.ts` as `Auto-restart on actionable tasks`.

`docs/deployment-guide.md` describes current actionable semantics:

- `docs/deployment-guide.md:21` says Boulder continues only when actionable tasks exist: `in_progress` plus ready/unblocked `pending`.
- `docs/deployment-guide.md:22` says blocked `pending` tasks alone do not trigger Boulder continuation, active prompt injection, compaction task context, or post-compaction recovery prompt.
- `docs/deployment-guide.md:23-24` correctly describe Esc cancellation and current commands.

### Remaining stale/incomplete-style wording

The stale wording is not fully gone from current source.

`hooks/boulder.ts` still contains non-actionable wording in the file header:

- `hooks/boulder.ts:1-6` says Boulder enforces actionable tasks, but line 6 still says the follow-up message lists `the outstanding tasks`.

`hooks/boulder.ts` still contains incomplete-style user-facing wording in the restart message:

- `hooks/boulder.ts:247` says `You have active/ready tasks that are not finished:`.

This is better than the previous broad `tasks still pending` wording, but it still fails the R3-C13 rerun criterion as stated: stale pending/incomplete Boulder wording should be gone outside negative command docs/audit trail. `not finished` is still incomplete-style wording, and `outstanding tasks` remains less precise than actionable tasks.

Additional non-failing observations:

- `hooks/boulder-countdown.ts:5` says `pending restart`, but this describes the countdown restart event, not pending tasks.
- `README.md:11` and `docs/deployment-guide.md:21-22` use `pending` only in the scoped, correct sense of ready/unblocked or blocked `pending` task semantics.
- `hooks/boulder.ts:31` has an internal `pendingCount` field name; this is not user-facing wording, though the surrounding R3-C13 issue is about source/user-facing consistency.

## Grep evidence

Command run from `my-plugins/oh-my-pi-v2`:

```bash
grep -RInE 'pending tasks|tasks still pending|incomplete|not complete|not finished|outstanding tasks|pending' hooks/boulder.ts hooks/boulder-countdown.ts hooks/context-recovery.ts README.md docs/deployment-guide.md
```

Output:

```text
hooks/boulder.ts:6: * the outstanding tasks.
hooks/boulder.ts:31:  pendingCount: number;
hooks/boulder.ts:247:    "You have active/ready tasks that are not finished:",
hooks/boulder-countdown.ts:5: * at any time during the countdown to cancel the pending restart.
README.md:11:- **Boulder loop** — auto-restarts the agent when actionable tasks remain (`in_progress` or ready/unblocked `pending`)
docs/deployment-guide.md:21:- Boulder 只会在存在 **actionable tasks** 时自动续跑：`in_progress` 任务 + ready/unblocked 的 `pending` 任务。
docs/deployment-guide.md:22:- 只有 blocked `pending` 任务时不会触发 Boulder 续跑、active prompt 注入、compaction task context 或 compaction 后恢复提示。
```

## Verdict

FAIL.

R3-C13 is not fully resolved because current `hooks/boulder.ts` still has stale/incomplete-style Boulder wording:

1. `hooks/boulder.ts:6` — `the outstanding tasks`
2. `hooks/boulder.ts:247` — `active/ready tasks that are not finished`

The source behavior and most docs now use actionable-task semantics, but the wording fix did not completely remove the stale wording outside audit trail material.
