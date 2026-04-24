# Round 2 Confirmation: R2-C5 / R2-C6

Scope constraints followed for audit-doc inputs: only `docs/audit/Round2/round-context.md` was read. Confirmation is based on source inspection plus targeted source grep.

## R2-C5 — malformed persisted task entries can replace healthy memory

**Verdict: CONFIRMED, with a shallow-gate qualifier.**

A malformed persisted task-state entry can replace the current in-memory task state if the persisted custom entry passes the loader's shallow validation: `data.tasks` must be an array and `data.nextId` must be a number. The loader does not validate the individual task objects before accepting and installing the persisted state.

Concrete runtime path:

1. `tools/task.ts` defines persisted task entries with custom type `omp-task-state`.
2. `getTaskStateFromEntry()` accepts a session entry when:
   - `entry.type === "custom"`
   - `entry.customType === "omp-task-state"`
   - `Array.isArray(data.tasks)`
   - `typeof data.nextId === "number"`
3. It does **not** validate task object shape, IDs, status values, dependency arrays, timestamps, or `nextId` consistency with the tasks.
4. `reloadState()` scans session entries, keeps the last accepted task-state payload, then unconditionally assigns:
   - `tasks = loadedTasks`
   - `nextId = loadedNextId`
5. `reloadState()` runs on session lifecycle hooks including `session_start` and `session_tree`, so a later malformed-but-shallowly-accepted persisted entry can replace otherwise healthy in-memory state.
6. Downstream task code assumes valid task objects. For example, `tools/task-helpers.ts` reads `task.blockedBy.length`, and `tools/task-actions.ts` uses dependency fields as arrays. A persisted task object missing or corrupting these fields can therefore become active state and later break task operations/rendering.

Rejection boundary:

- The claim is **not** confirmed for arbitrary malformed persisted entries. Entries that fail the shallow loader gate, such as non-array `tasks` or non-number `nextId`, are ignored by `getTaskStateFromEntry()` and do not replace memory through this path.

## R2-C6 — context auto-compaction latch can stick if `ctx.compact` throws synchronously

**Verdict: CONFIRMED.**

The auto-compaction latch can remain set after a synchronous `ctx.compact()` throw because the session ID is added to the latch set before calling `ctx.compact()`, and the local catch path does not clear it.

Concrete runtime path:

1. `hooks/context-recovery.ts` maintains `compactedSessions`, a `Set` of session IDs that have already triggered auto-compaction.
2. In the `before_agent_start` hook, when token usage crosses the auto-compaction threshold and the session is not already in `compactedSessions`, the code executes:
   - `compactedSessions.add(sessionId)`
   - `ctx.compact()`
3. `ctx.compact()` is called without `await` and without a local `try/finally` around the latch add/call pair.
4. The enclosing `before_agent_start` catch swallows errors and returns `undefined`, but it does not delete `sessionId` from `compactedSessions`.
5. Cleanup of the latch is only visible in later `session_compact` and `session_shutdown` handlers.
6. Therefore, if `ctx.compact()` throws synchronously before emitting a `session_compact` event, the session ID remains in `compactedSessions`. Later `before_agent_start` executions for the same session will see the latch as already set and skip auto-compaction until a separate cleanup path occurs.

Notes:

- Source grep found the relevant `ctx.compact()` call in `hooks/context-recovery.ts`; `hooks/custom-compaction.ts` implements the `session_before_compact` custom compaction path and does not call `ctx.compact()`.
- The confirmation is specifically for synchronous throw behavior at the auto-compaction trigger site in `context-recovery.ts`.
