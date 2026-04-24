# Round 3 Audit: Documentation / Source Consistency

Scope: read `docs/audit/Round3/round-context.md`, then inspected non-audit docs and source only. Audit trail files were excluded from searches and findings.

## Findings

### HOARE-DOC-R3-001 — README recommended-extension list is stale relative to the deployment guide and current subagent dependency docs

- **Type**: Documentation/source consistency
- **Severity**: Low
- **Files**:
  - `README.md:27-41`
  - `docs/deployment-guide.md:7-15`
  - `docs/deployment-guide.md:73-80`
  - `docs/deployment-guide.md:141-145`
- **Evidence**:
  - `README.md` says the recommended extensions are `pi-mcp-adapter` and `pi-web-access`, and its summary table omits `pi-intercom`.
  - `docs/deployment-guide.md` says `pi-web-access` and `pi-intercom` are the recommended dependencies for `pi-subagents`; it classifies `pi-mcp-adapter` as optional MCP protocol support.
  - Repository-wide non-audit search found `pi-intercom` only in the deployment guide, while README still presents `pi-mcp-adapter` as recommended.
- **Why this matters**: A user following only the README gets a different recommended install set than the deployment guide and may omit `pi-intercom`, which the deployment guide says improves/enables pi-subagents session bridging.
- **Suggested fix**: Update README’s recommended-extension section/table to include `pi-intercom` as recommended and demote `pi-mcp-adapter` to optional, matching `docs/deployment-guide.md`.

### HOARE-DOC-R3-002 — Boulder restart user-facing text says “pending tasks” for the actionable task set

- **Type**: Source text/docstring consistency
- **Severity**: Low
- **Files**:
  - `hooks/boulder.ts:237-254`
  - `hooks/boulder-countdown.ts:24-40`
  - Ground truth/source contract: `tools/task.ts:31-49`, `tools/task.ts:110-118`, `hooks/boulder.ts:94-164`
- **Evidence**:
  - Boulder correctly computes restart work from `in_progress` tasks plus `readyTasks` / unblocked `pending` tasks.
  - `hooks/boulder.ts` assigns `pending = getActionableTasks(tasks, readyTasks)`, then renders `You have pending tasks that are not complete:`.
  - `hooks/boulder-countdown.ts` documents its `pending` parameter as “Number of pending tasks”, even though callers pass `actionableCount`.
- **Why this matters**: Round 3’s contract requires non-audit docs and user-visible task semantics to distinguish blocked pending tasks from actionable work. The implementation behavior is correct, but the emitted wording can make users think all pending tasks, including blocked pending tasks, drive Boulder continuation.
- **Suggested fix**: Rename local display variables/doc comments from `pending` to `actionable`/`active`, and change the restart message to “You have actionable tasks that are not complete:” or “You have active/ready tasks that are not complete:”.
