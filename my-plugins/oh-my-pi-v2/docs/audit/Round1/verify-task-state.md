# Verify task state transitions and persistence/reload failure handling

Scope: Round 1 verification for task state transitions and persistence/reload failure handling in `my-plugins/oh-my-pi-v2`. Source inspected: `tools/task.ts`, `tools/task-actions.ts`, `index.ts`, and host append-entry API/source in `packages/coding-agent/src/core/extensions/types.ts`, `packages/coding-agent/src/core/extensions/loader.ts`, and `packages/coding-agent/src/core/session-manager.ts`.

## Results

| Fix point | Result |
|---|---|
| `task.start` cannot resurrect done/expired tasks | PASS |
| Reload does not clear current task state before successful session iteration | PASS |
| Persistence happens before notification and persistence failure is logged/rethrown | PASS |
| Callback/widget failures are observable and non-throwing | PASS |

## Evidence

### 1. `task.start` cannot resurrect done/expired tasks — PASS

Evidence:

- `my-plugins/oh-my-pi-v2/tools/task.ts:144` dispatches the `start` action to `executeStart(params.id, tasks, nextId)`.
- `my-plugins/oh-my-pi-v2/tools/task-actions.ts:50-65` validates the task before mutating it.
- `my-plugins/oh-my-pi-v2/tools/task-actions.ts:54` has the terminal-state guard: `if (task.status !== "pending") return err("start", \`task #${id} is ${task.status} and cannot be started\`, tasks, nextId);`.
- `my-plugins/oh-my-pi-v2/tools/task-actions.ts:62-65` sets `task.status = "in_progress"` only after the non-`pending` guard and blocker checks pass.

Conclusion: `done`, `expired`, and already-`in_progress` tasks are rejected before any mutation to `in_progress`, so `task.start` cannot resurrect terminal tasks.

### 2. Reload does not clear current task state before successful session iteration — PASS

Evidence:

- `my-plugins/oh-my-pi-v2/tools/task.ts:76-85` loads into local variables first: `loadedTasks` and `loadedNextId`.
- `my-plugins/oh-my-pi-v2/tools/task.ts:79-82` iterates `ctx.sessionManager.getEntries()` and updates only those local variables while scanning session entries.
- `my-plugins/oh-my-pi-v2/tools/task.ts:84-85` assigns the live closure state only after iteration finishes: `tasks = loadedTasks;` and `nextId = loadedNextId;`.

Conclusion: if `getEntries()` or session-entry iteration throws, the previous live `tasks`/`nextId` state has not yet been cleared or replaced. State is updated only after successful iteration.

### 3. Persistence happens before notification and persistence failure is logged/rethrown — PASS

Evidence in plugin code:

- `my-plugins/oh-my-pi-v2/tools/task.ts:88-90` persists by calling `pi.appendEntry(TASK_ENTRY_TYPE, { tasks: [...tasks], nextId })`.
- `my-plugins/oh-my-pi-v2/tools/task.ts:150-157` handles mutating actions by calling `persistState()` before `notifyChange()`.
- `my-plugins/oh-my-pi-v2/tools/task.ts:153-156` catches persistence failure, logs `[oh-my-pi task] Failed to persist task state: ...`, and rethrows the same failure path with `throw error;`.

Evidence in host append-entry API/source:

- `packages/coding-agent/src/core/extensions/types.ts:1142-1143` documents `appendEntry` as session state persistence: “Append a custom entry to the session for state persistence (not sent to LLM).” The signature is `appendEntry<T = unknown>(customType: string, data?: T): void;`.
- `packages/coding-agent/src/core/extensions/loader.ts:230-231` delegates extension calls directly with `runtime.appendEntry(customType, data);` and does not catch errors locally.
- `packages/coding-agent/src/core/session-manager.ts:821-825` appends the entry to session state and then calls `_persist(entry)`.
- `packages/coding-agent/src/core/session-manager.ts:811-818` persists via `appendFileSync(...)`; no catch is present in the inspected `_persist`/`_appendEntry` path, so synchronous persistence failures propagate back to the plugin's `persistState()` try/catch.

Conclusion: mutation persistence is attempted before task-change notification. A persistence failure is observable through `console.error` and is rethrown, preventing a successful notification path after failed persistence.

### 4. Callback/widget failures are observable and non-throwing — PASS

Task-change callback wrapper evidence:

- `my-plugins/oh-my-pi-v2/tools/task.ts:55-60` wraps `onTaskChange?.([...tasks])` in `try/catch`.
- The catch logs `[oh-my-pi task] Task change callback failed: ...` via `console.error` and does not rethrow.

Widget update evidence:

- `my-plugins/oh-my-pi-v2/index.ts:58-120` wraps task widget/notification update logic inside `try/catch` in the `setOnTaskChange` callback.
- `my-plugins/oh-my-pi-v2/index.ts:117` calls `latestCtx.ui.setWidget("omp-tasks", lines)` inside that try block.
- `my-plugins/oh-my-pi-v2/index.ts:58-120` catch logs `[oh-my-pi task] Widget update failed: ...` via `console.error` and does not rethrow.

Conclusion: task-change callback failures and widget update failures are observable through error logs and are intentionally swallowed so they do not throw into the host hook/tool path.

## Final verdict

PASS for all requested Round 1 task-state verification points.
