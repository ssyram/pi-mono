# Round 2 confirmation: R2-C9 / R2-C10

Scope: fresh-eyes confirmation using only `docs/audit/Round2/round-context.md` from audit docs plus product docs/source.

## R2-C9 — README overstates Boulder as restarting for incomplete tasks

**Verdict: CONFIRMED.**

The README describes Boulder in broader terms than the runtime contract and implementation support:

- `README.md:11` says: `Boulder loop` “auto-restarts the agent when tasks remain incomplete.”
- `README.md:52` comments the config flag as “Toggle Boulder auto-restart loop.”
- `README.md:85` describes `hooks/boulder.ts` as “Auto-restart on incomplete tasks.”

The runtime path is narrower: Boulder restarts only for **actionable** tasks, not every incomplete task.

Concrete source path:

- `hooks/boulder.ts:93-99` obtains task state and returns when `actionableCount === 0`.
- `hooks/boulder.ts:127-146` builds restart/stagnation behavior from `getActionableTasks(tasks, readyTasks)` and `actionableCount`.
- `hooks/boulder.ts:155-166` re-checks fresh state before restart and returns when `fresh.actionableCount === 0`.
- `hooks/boulder.ts:180-185` defines actionable tasks as `status === "in_progress"` plus `readyTasks`.
- `tools/task.ts:39-49` builds the actionable task list as `in_progress` plus `pending && isUnblocked(...)`.
- `tools/task.ts:123-130` states the loop restarts if tasks remain `in_progress` or ready.
- `tools/task-helpers.ts:32-49` distinguishes blocked pending tasks from ready pending tasks.

Rejection check: runtime does **not** restart merely because any task is incomplete. Blocked pending tasks are incomplete but not actionable/ready and therefore do not trigger Boulder continuation. The README wording is stale/overbroad.

## R2-C10 — context recovery and edit-error recovery swallow local hook failures silently

**Verdict: CONFIRMED for local/synchronous hook-body failures. NOT confirmed for host/API async `sendUserMessage` delivery failures.**

Concrete source path for context recovery:

- `hooks/context-recovery.ts:31-81` wraps `before_agent_start` context warning/compaction logic in `try`; the `catch` at `76-79` only comments that hooks must never throw and returns `undefined`.
- `hooks/context-recovery.ts:83-109` wraps `session_compact` task restoration and `pi.sendUserMessage(...)` in `try`; the `catch` at `105-107` only comments that hooks must never throw.
- `hooks/context-recovery.ts:111-123` wraps `session_shutdown` cleanup in `try`; the `catch` at `119-121` only comments that hooks must never throw.

No logging, diagnostics, UI warning, failure counter, or disable path is present in those catch blocks.

Concrete source path for edit-error recovery:

- `hooks/edit-error-recovery.ts:59-98` registers a `tool_result` hook with a broad `try/catch`.
- `hooks/edit-error-recovery.ts:61-95` contains the edit-error hint logic.
- The `catch` at `hooks/edit-error-recovery.ts:95-98` only comments that hooks must never throw and returns `undefined`.

No logging, diagnostics, UI warning, failure counter, or disable path is present in that catch block.

Boundary/rationale:

- This confirms silent swallowing for local synchronous exceptions thrown inside those hook bodies.
- This does not independently confirm async host delivery failures from `pi.sendUserMessage(...)` as a local bug, because the extension-facing call is `void`/not awaited in the observed paths. Per the round context, that class is a host/API limitation unless there is a local deterministic workaround.
- Boulder itself is a contrast case, not part of this candidate’s confirmed defect: `hooks/boulder.ts:187-203`, `218-227`, and `255-269` log/record failures, attempt UI warning, and disable Boulder after repeated failures.
