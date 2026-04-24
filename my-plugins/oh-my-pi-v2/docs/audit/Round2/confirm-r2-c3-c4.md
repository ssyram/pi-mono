# Round 2 confirmation: R2-C3 / R2-C4

## R2-C3 — CONFIRMED

**Verdict:** Confirmed.

**Claim:** Reload erases live in-memory task state when no valid persisted entry exists.

**Runtime path:**
1. Task state is module-local: `tasks` and `nextId` in `tools/task.ts`.
2. `session_start` and `session_tree` both call `reloadState(ctx)`.
3. `reloadState` initializes `loadedTasks = []` and `loadedNextId = 1`.
4. It scans `ctx.sessionManager.getEntries()` and only accepts entries where `type === "custom"`, `customType === "omp-task-state"`, `data.tasks` is an array, and `data.nextId` is a number.
5. If no valid entry exists, those defaults remain.
6. It then unconditionally assigns `tasks = loadedTasks; nextId = loadedNextId; notifyChange();`.

**Consequence:** Any existing live in-memory task list is replaced by `[]` during reload when the session has no valid persisted task-state entry.

## R2-C4 — CONFIRMED

**Verdict:** Confirmed.

**Claim:** Mutating task actions can leave unpersisted in-memory state after synchronous `appendEntry` failure.

**Runtime path:**
1. Tool execution marks every action except `list` as mutating.
2. Mutating action handlers run before persistence.
3. `executeAdd` pushes into the live `tasks` array and returns a new `nextId`.
4. `executeStart`, `executeDoneOrExpire`, and `executeUpdateDeps` mutate existing task objects/dependency arrays in place.
5. `clear` directly sets `tasks = []; nextId = 1` before persistence.
6. After mutation, `persistState()` calls `pi.appendEntry("omp-task-state", { tasks: [...tasks], nextId })`.
7. If `appendEntry` throws synchronously, the catch logs and rethrows, but there is no rollback of `tasks`, task objects, dependency arrays, or `nextId`.
8. `notifyChange()` is skipped because it is after successful persistence, but the module-local state remains mutated.

**Consequence:** A failed append can leave runtime memory ahead of durable session state until later reload or overwrite.
