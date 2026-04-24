# Round 2 Protocol/State-Machine Audit — Boulder

## Finding R2-SM-001 — Stagnation threshold does not enter a halted state; it enqueues another agent turn

**Severity:** High

**Violated Hoare invariant:** After Boulder detects no progress for the same actionable task set at the stagnation threshold, auto-continuation for that stagnant state must stop until external state changes. Formally, for unchanged active set `A`, `{stagnationCount >= 3 ∧ active(A)}` `handleStagnation` `{no new agent turn is injected for A ∧ Boulder remains halted/disabled for A}`.

**References:**
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts:128-143` — unchanged actionable task IDs increment `stagnationCount`; `stagnationCount >= 3` calls `handleStagnation(...)` and returns.
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts:207-230` — `handleStagnation` builds “Stopping auto-continuation.” but calls `pi.sendUserMessage(...)` / `pi.sendUserMessage(..., { deliverAs: "followUp" })`, then only resets `stagnationCount = 0`.
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts:196-204` — the only local Boulder disable transition is in `recordBoulderFailure`; `handleStagnation` does not set `disabled = true` or latch the stagnant task set.

**Concrete counterexample runtime path:**
1. Task state contains one actionable task `#1` (`in_progress` or unblocked `pending`), and the agent repeatedly exits without changing task state.
2. On consecutive `agent_end` events, `getActionableTasks(...).map(id)` remains `[1]`, so `boulder.ts:128-135` increments `stagnationCount`.
3. On the third unchanged detection, `boulder.ts:141-143` calls `handleStagnation`.
4. `handleStagnation` sends a new user message/follow-up at `boulder.ts:220-224` even though the message says “Stopping auto-continuation.”
5. The send itself is another injected turn/follow-up for the same stagnant task state; after that turn exits unchanged, `stagnationCount` has been reset to `0` at `boulder.ts:229`, so the same cycle can repeat forever in groups of three instead of staying halted.

## Finding R2-SM-002 — Context-recovery auto-compaction is not once-per-session because the latch is cleared by compaction

**Severity:** Medium

**Violated Hoare invariant:** Auto-compaction at the 78% threshold is a per-session one-shot transition. Formally, for a session `S`, `{S ∈ compactedSessions}` must remain true after `session_compact(S)` until `session_shutdown(S)` or an explicit new session boundary; otherwise `before_agent_start` can repeatedly auto-compact the same session.

**References:**
- `my-plugins/oh-my-pi-v2/hooks/context-recovery.ts:4-6` — file-level contract says 78% usage triggers automatic compaction “once per session”.
- `my-plugins/oh-my-pi-v2/hooks/context-recovery.ts:20-24` — `compactedSessions` is the session latch.
- `my-plugins/oh-my-pi-v2/hooks/context-recovery.ts:41-56` — `before_agent_start` checks `!compactedSessions.has(sessionId)`, adds `sessionId`, then calls `ctx.compact()`.
- `my-plugins/oh-my-pi-v2/hooks/context-recovery.ts:83-90` — `session_compact` deletes the same `sessionId` from `compactedSessions`.

**Concrete counterexample runtime path:**
1. Session `S` reaches `usage >= AUTO_COMPACT_THRESHOLD` before an agent turn.
2. `before_agent_start` sees `!compactedSessions.has(S)`, adds `S`, and calls `ctx.compact()` at `context-recovery.ts:41-56`.
3. The resulting `session_compact` event runs and deletes `S` from `compactedSessions` at `context-recovery.ts:88-90`.
4. The session remains above 78% after compaction, or later rises above 78% again in the same session.
5. A later `before_agent_start` again observes `!compactedSessions.has(S)` and calls `ctx.compact()` again, violating the one-shot session state machine and allowing repeated automatic compactions in one session.

## Finding R2-SM-003 — Task reload can erase live in-memory task state when no valid persisted task-state entry is found

**Severity:** High

**Violated Hoare postcondition:** Failed or non-authoritative reload must preserve current in-memory task state. Formally, `{tasks = T ∧ nextId = N ∧ reload has no valid authoritative task-state entry}` `reloadState` `{tasks = T ∧ nextId = N}`. This is required so active-task prompt injection, Boulder restart decisions, and compaction/context-restoration all observe the same live task state after a reload anomaly.

**References:**
- `my-plugins/oh-my-pi-v2/tools/task.ts:76-86` — `reloadState` initializes `loadedTasks = []`, `loadedNextId = 1`, scans entries, then unconditionally assigns `tasks = loadedTasks` and `nextId = loadedNextId`.
- `my-plugins/oh-my-pi-v2/tools/task.ts:92-93` — `reloadState` runs on `session_start` and `session_tree`.
- `my-plugins/oh-my-pi-v2/tools/task.ts:97-117` — active-task prompt injection depends on the in-memory `tasks` array.
- `my-plugins/oh-my-pi-v2/tools/task.ts:168-177` — `getTaskState` derives `readyTasks` and `actionableCount` from the in-memory `tasks` array.
- `my-plugins/oh-my-pi-v2/hooks/boulder.ts:95-99` — Boulder returns without continuation when `actionableCount === 0`.

**Concrete counterexample runtime path:**
1. In session `S`, live memory contains `tasks = [{ id: 1, text: "finish audit", status: "in_progress", ... }]` and `nextId = 2`.
2. A `session_tree` event fires while `ctx.sessionManager.getEntries()` returns no valid `omp-task-state` entry for `S` (for example, a cloned/tree context before custom entries are materialized, or entries containing only malformed task-state data rejected by `getTaskStateFromEntry`).
3. `reloadState` starts with `loadedTasks = []` and `loadedNextId = 1`; because no entry is accepted, those defaults remain.
4. `reloadState` unconditionally assigns `tasks = []` and `nextId = 1` at `task.ts:83-84`, then notifies listeners.
5. Subsequent `getTaskState` reports `actionableCount = 0`; Boulder’s `agent_end` path at `boulder.ts:95-99` resets and returns, prompt injection at `task.ts:97-117` is skipped, and compaction/context-restoration receive no active task context. The live actionable task was lost solely because reload lacked a valid authoritative entry.
