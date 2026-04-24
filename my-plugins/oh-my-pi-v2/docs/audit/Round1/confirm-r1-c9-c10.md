# Round 1 Fresh-Eyes Confirmation: R1-C9 / R1-C10

Scope constraints honored: reviewed `docs/audit/Round1/round-context.md` and source needed for task-tool failure handling, Boulder task-state use, and host `appendEntry` semantics. No candidate/audit reports were read.

## R1-C9 — task-change callback failures lack central observable non-throwing boundary

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. `index.ts` registers the task tool and installs a task-change callback:
   - `registerTaskTool(pi)` returns `getTaskState` / `setOnTaskChange`.
   - `setOnTaskChange((tasks) => { try { ... } catch { ... } })` updates the persistent task widget through `latestCtx.ui.notify(...)`, `latestCtx.ui.setWidget(...)`, and `latestCtx.ui.clearWidget(...)`.
2. `tools/task.ts` stores that callback as `onTaskChange` and defines `notifyChange = () => onTaskChange?.([...tasks])`.
3. `tools/task.ts` calls `notifyChange()` from reload paths (`session_start`, `session_tree`) and after every mutating task-tool action.
4. If the concrete widget callback fails while performing the UI update, the callback-local `catch` in `index.ts` swallows it with only the comment `Widget update must never crash the task tool.` There is no log, diagnostic entry, UI warning, counter, or disablement path.

Why this confirms the claim:

- The actual installed callback has a non-throwing boundary, but it is local and silent, not a central observable boundary.
- `tools/task.ts` has no wrapper around `notifyChange()` that would standardize callback containment, diagnostics, repeated-failure tracking, or fallback behavior.
- Round context requires hook/task failures to be non-throwing **and observable**, with repeated failures eventually disabling Boulder and notifying the user. The reachable widget-update failure path is non-throwing but hidden.

Concrete impact:

- A task mutation can succeed and Boulder can keep operating while the task widget silently stops reflecting state changes.
- The user receives no diagnostic signal that task-change callback processing is broken.

## R1-C10 — persistence failure after in-memory task mutation causes durable state drift

**Verdict: CONFIRMED — triggering**

Concrete runtime path:

1. `tools/task.ts` task-tool `execute` handles all mutating actions by first applying the action to in-memory state:
   - `add`, `start`, `done`, `expire`, and `update_deps` delegate into `tools/task-actions.ts`, where successful paths mutate the task array/task objects before returning.
   - `clear` directly assigns `tasks = []; nextId = 1` in `tools/task.ts`.
2. After mutation, `tools/task.ts` calls `notifyChange()`.
3. Only after notification does `tools/task.ts` call `persistState()`.
4. `persistState()` calls `pi.appendEntry(TASK_ENTRY_TYPE, { tasks: [...tasks], nextId })` with no local `try/catch`, rollback, retry, diagnostic, or return-value verification.
5. Host semantics for `appendEntry` are synchronous and durability-affecting:
   - Extension API type declares `appendEntry<T = unknown>(customType: string, data?: T): void`.
   - Extension binding delegates directly to runtime/session behavior without local error conversion.
   - `agent-session.ts` delegates `appendEntry` to `sessionManager.appendCustomEntry(customType, data)`.
   - `SessionManager.appendCustomEntry(...)` constructs a custom entry and calls `_appendEntry(entry)`.
   - `_appendEntry(entry)` mutates session-manager memory (`fileEntries`, indexes, leaf id) and then calls `_persist(entry)`.
   - `_persist(entry)` writes with `appendFileSync(...)` in the normal persistence path; no local rollback/catch is visible around that write path.

Why this confirms the claim:

- The task tool mutates its own in-memory task state before durable persistence is attempted.
- The UI/task-change notification is also emitted before durable persistence is attempted.
- If `appendEntry` / `appendFileSync` fails after the task mutation, the task tool has already changed live memory and potentially the visible widget, but the durable custom session entry is absent/stale.
- On a later session reload, `tools/task.ts` reconstructs task state from the latest persisted `omp-task-state` custom entry; that reload will not include the failed mutation.

Concrete impact:

- Current process memory and UI can show the new task state while disk/session-backed state remains old.
- After restart/session-tree reload, task state can revert to the previous durable entry, creating durable state drift for Boulder decisions that depend on `getTaskState()`.
