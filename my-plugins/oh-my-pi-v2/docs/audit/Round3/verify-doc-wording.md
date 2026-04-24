# Round 3 Documentation / User-Facing Wording Verification

Scope: verify R3-C5, R3-C12, and R3-C13 against the current README, deployment guide, `hooks/boulder.ts`, `hooks/boulder-countdown.ts`, and `hooks/context-recovery.ts`.

Audit inputs read:
- `docs/audit/Round3/round-context.md`
- `docs/audit/Round3/candidates.md`
- `docs/audit/Round3/reduction.md`

Relevant Round 3 baseline:
- Active/actionable work is `in_progress` plus ready/unblocked `pending`.
- Blocked `pending` tasks alone must not trigger Boulder continuation, active prompt injection, compaction task context, or context-restoration continuation.
- There is no `/omp-stop` and no persistent command-level stop latch.
- R3-RC5 expects README/deployment guide/restart/countdown wording to align with actionable-task semantics and extension lists to align.

## R3-C5 — Deployment guide actionable-task and command semantics

Status: PASS

Evidence:
- `docs/deployment-guide.md:21` defines Boulder continuation as actionable work: `in_progress` tasks plus ready/unblocked `pending` tasks.
- `docs/deployment-guide.md:22` says blocked `pending` tasks alone do not trigger Boulder continuation, active prompt injection, compaction task context, or post-compaction recovery prompt.
- `docs/deployment-guide.md:23` says Esc cancels only the current Boulder countdown and does not create a persistent stop latch.
- `docs/deployment-guide.md:24` lists the current commands as `/omp-start`, `/omp-consult`, and `/omp-review`, and explicitly says there is no `/omp-stop`.
- `README.md:11` also describes the Boulder loop as restarting only when actionable tasks remain, defined as `in_progress` or ready/unblocked `pending`.
- Source alignment: `hooks/boulder.ts:94-95` reads `actionableCount` and skips restart when `actionableCount === 0`; `hooks/boulder.ts:183-185` builds actionable tasks from in-progress tasks plus ready tasks.
- Source alignment: `hooks/context-recovery.ts:99-107` checks `actionableCount === 0`, then restores only in-progress plus ready tasks with the prompt labels `Active tasks` and `Please continue working on these tasks.`

Conclusion: deployment/user docs now state the actionable-task semantics and current command semantics required by the Round 3 baseline.

## R3-C12 — README recommended-extension list alignment

Status: PASS

Evidence:
- `README.md:17`, `README.md:22`, `README.md:25`, and `README.md:46` identify `pi-subagents` as required for delegation and the `subagent` tool.
- `README.md:31` and `README.md:47` list `pi-web-access` as recommended.
- `README.md:33-34` and `README.md:48` list `pi-intercom` as recommended.
- `README.md:41` and `README.md:49` list `pi-mcp-adapter` as optional MCP support.
- `docs/deployment-guide.md:9-12` has the same dependency tiering: `pi-subagents` required, `pi-web-access` recommended, `pi-intercom` recommended.
- `docs/deployment-guide.md:101` and `docs/deployment-guide.md:154` list `pi-mcp-adapter` as optional.
- `docs/deployment-guide.md:130-141` one-shot install script installs required `pi-subagents` plus recommended `pi-web-access` and `pi-intercom`.

Conclusion: README and deployment guide are aligned. The prior stale mismatch is fixed: `pi-intercom` is present as recommended, and `pi-mcp-adapter` is treated as optional rather than recommended.

## R3-C13 — Boulder/countdown pending/incomplete wording

Status: FAIL

Evidence passing:
- `hooks/boulder.ts:2` and `hooks/boulder.ts:4` describe Boulder as acting on actionable tasks.
- `hooks/boulder.ts:94-95` uses `actionableCount` and skips restart when there are zero actionable tasks.
- `hooks/boulder.ts:183-185` returns in-progress tasks plus ready tasks from `getActionableTasks()`.
- `hooks/boulder-countdown.ts:40` displays `Restarting in ${remaining}s (${actionable} actionable tasks) — press Esc to cancel`.
- `hooks/boulder-countdown.ts:67` displays `Task restart cancelled.` when Esc cancels the countdown.

Evidence failing:
- `hooks/boulder.ts:6` still says the restart prompt lists `outstanding tasks`, which is less precise than actionable tasks.
- `hooks/boulder.ts:213` still emits the user-facing stagnation wording `tasks still pending`.
- `hooks/boulder.ts:247` still emits the user-facing restart wording `You have actionable tasks that are not complete:`.
- `hooks/boulder-countdown.ts:5` still contains a comment saying Esc cancels `the pending restart`; this is not user-facing and does not mention pending tasks, but it is still stale pending wording in the countdown source comments.

Conclusion: countdown UI wording is fixed, and Boulder control flow uses actionable semantics, but R3-C13 is not fully fixed because `hooks/boulder.ts` still contains user-facing stale pending/incomplete-style wording (`tasks still pending`, `not complete`) and a less precise `outstanding tasks` comment.

## Overall

- R3-C5: PASS
- R3-C12: PASS
- R3-C13: FAIL

Round 3 documentation alignment is mostly complete, but the Boulder user-facing wording in `hooks/boulder.ts` still needs cleanup before R3-C13 can pass.
