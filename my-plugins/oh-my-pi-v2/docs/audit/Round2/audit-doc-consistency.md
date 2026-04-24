# Round 2 Audit: Non-audit documentation/spec consistency

Scope: `README.md`, `docs/deployment-guide.md`, package metadata, command registration source, task source, and Boulder source. Audit trail files were not used as documentation evidence.

## Findings

### DOC-CONSISTENCY-001 — README overstates Boulder continuation as all incomplete tasks

**Hoare contract**
- **Precondition:** Boulder/task docs describe automatic continuation semantics.
- **Postcondition:** Docs must match the current contract: active/actionable work is `in_progress` plus ready unblocked `pending`; blocked pending tasks alone must not trigger automatic continuation, active-task prompt injection, compaction task context, or context-restoration continuation.
- **Invariant:** No non-audit documentation should imply that every incomplete/pending/blocked task keeps Boulder running.

**Documentation evidence**
- `README.md:11` says Boulder “auto-restarts the agent when tasks remain incomplete.”
- `README.md:86` describes `hooks/boulder.ts` as “Auto-restart on incomplete tasks.”

**Source/spec evidence**
- `tools/task.ts` builds actionable tasks from `in_progress` tasks plus `pending && isUnblocked(...)`, and describes restarts only when tasks remain `in_progress` or `ready`.
- `hooks/boulder.ts` gates restart on `actionableCount` and builds restart work from `in_progress` tasks plus `readyTasks`.
- `index.ts`, `hooks/context-recovery.ts`, and `hooks/custom-compaction.ts` use the same `in_progress + ready/unblocked pending` active-work model.

**Impact**
The README wording is stale/broader than the current implementation and spec. A user could reasonably expect blocked pending tasks or any incomplete task to trigger Boulder continuation, which contradicts the current actionable-task semantics.

**Suggested documentation fix**
Replace “incomplete tasks” wording with “in-progress or ready unblocked pending tasks,” and explicitly note that blocked pending tasks alone do not trigger Boulder continuation.

## Non-findings checked

- No stale `/omp-stop` command documentation was found in the inspected non-audit docs or command registration source.
- `docs/deployment-guide.md` documents Esc as a single Boulder countdown cancellation and does not claim a persistent stop latch.
- Package metadata did not document commands or Boulder semantics.
