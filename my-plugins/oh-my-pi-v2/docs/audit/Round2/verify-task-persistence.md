# Round 2 Task Persistence Verification

Scope: verified only against `docs/audit/Round2/round-context.md` and source files `tools/task.ts`, `tools/task-state-entry.ts`, `tools/task-actions.ts`, and `tools/task-helpers.ts`.

## Result Summary

| Fix point | Verdict | Summary |
|---|---:|---|
| R2-C3 — task reload preserves in-memory state when no valid persisted state is available | PASS | `reloadState()` only assigns `tasks`/`nextId` after finding a valid loaded state; otherwise it returns without mutation. |
| R2-C4 — persisted task-state validation | PASS | `getTaskStateFromEntry()` validates persisted custom entry data, and `validateTaskStateEntryData()` rejects malformed state, malformed tasks, duplicate IDs, invalid `nextId`, invalid dependency refs, and cycles. |
| R2-C5 — rollback/no notification on persistence failure | PASS | Mutating task actions snapshot prior state, persist inside `try`, restore `tasks`/`nextId` and rethrow on failure, and call `notifyChange()` only after successful persistence. |

## R2-C3 — Task reload preserves in-memory state

**Verdict: PASS**

Source evidence:

- `tools/task.ts:79-88`:

```ts
const reloadState = async (ctx: ExtensionContext) => {
	let loaded: TaskStateEntry | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		const state = getTaskStateFromEntry(entry);
		if (state) loaded = state;
	}
	if (!loaded) return;
	tasks = cloneTasks(loaded.tasks);
	nextId = loaded.nextId;
	notifyChange();
};
```

Analysis:

- `reloadState()` does not clear or replace current `tasks`/`nextId` before reading session entries.
- If no valid task-state entry is loaded, `if (!loaded) return;` exits before assigning `tasks` or `nextId`.
- State mutation occurs only after a valid `loaded` state exists, at `tasks = cloneTasks(loaded.tasks)` and `nextId = loaded.nextId`.
- This satisfies the Round 2 contract that failed/invalid session reload must not destroy current in-memory task state.

## R2-C4 — Persisted-state validation

**Verdict: PASS**

Source evidence:

- `tools/task.ts:70-77`:

```ts
function getTaskStateFromEntry(entry: SessionEntry): TaskStateEntry | undefined {
	if (entry.type !== "custom" || entry.customType !== TASK_ENTRY_TYPE) return undefined;
	const state = validateTaskStateEntryData(entry.data);
	if (!state) {
		console.error("[oh-my-pi task] Ignoring invalid persisted task state entry");
	}
	return state;
}
```

- `tools/task-state-entry.ts:19-38`:

```ts
export function validateTaskStateEntryData(data: unknown): TaskStateEntry | undefined {
	if (!isRecord(data)) return undefined;
	if (!Array.isArray(data.tasks) || typeof data.nextId !== "number") return undefined;
	if (!Number.isInteger(data.nextId) || data.nextId < 1) return undefined;

	const tasks: Task[] = [];
	const ids = new Set<number>();
	for (const value of data.tasks) {
		const task = parseTask(value);
		if (!task || ids.has(task.id)) return undefined;
		ids.add(task.id);
		tasks.push(task);
	}

	const maxId = tasks.reduce((max, task) => Math.max(max, task.id), 0);
	if (data.nextId <= maxId) return undefined;
	if (!dependenciesReferenceExistingTasks(tasks, ids)) return undefined;
	if (hasDependencyCycle(tasks)) return undefined;

	return { tasks, nextId: data.nextId };
}
```

- `tools/task-state-entry.ts:41-58`:

```ts
function parseTask(value: unknown): Task | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.id !== "number" || !Number.isInteger(value.id) || value.id < 1) return undefined;
	if (typeof value.text !== "string" || value.text.trim().length === 0) return undefined;
	if (!isTaskStatus(value.status)) return undefined;
	if (!isNumberArray(value.blocks) || !isNumberArray(value.blockedBy)) return undefined;
	if (typeof value.createdAt !== "number" || typeof value.updatedAt !== "number") return undefined;
	if (value.expireReason !== undefined && typeof value.expireReason !== "string") return undefined;
	return {
		id: value.id,
		text: value.text,
		status: value.status,
		blocks: [...value.blocks],
		blockedBy: [...value.blockedBy],
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		expireReason: value.expireReason,
	};
}
```

- `tools/task-state-entry.ts:65-97`:

```ts
function isTaskStatus(value: unknown): value is TaskStatus {
	return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}

function isNumberArray(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isInteger(item) && item > 0);
}

function dependenciesReferenceExistingTasks(tasks: Task[], ids: Set<number>): boolean {
	for (const task of tasks) {
		for (const id of [...task.blocks, ...task.blockedBy]) {
			if (id === task.id || !ids.has(id)) return false;
		}
	}
	return true;
}

function hasDependencyCycle(tasks: Task[]): boolean {
	const blockedBy = new Map(tasks.map((task) => [task.id, task.blockedBy]));
	for (const task of tasks) {
		const visited = new Set<number>();
		const queue = [...task.blockedBy];
		while (queue.length > 0) {
			const id = queue.shift();
			if (id === undefined) continue;
			if (id === task.id) return true;
			if (visited.has(id)) continue;
			visited.add(id);
			queue.push(...(blockedBy.get(id) ?? []));
		}
	}
	return false;
}
```

Analysis:

- Only custom entries of the task-state type are considered.
- Persisted data must pass `validateTaskStateEntryData()` before it can be loaded.
- Validation covers top-level object shape, `tasks` array, integer positive `nextId`, per-task shape, valid status, dependency arrays, timestamps, optional `expireReason`, duplicate IDs, `nextId > maxId`, missing/self dependency references, and dependency cycles.
- Invalid persisted task-state entries return `undefined`, are logged, and are ignored by reload.

Additional start/readiness evidence from the inspected files:

- `tools/task-actions.ts:50-65` rejects start unless the task is `pending` and unblocked; terminal `done`/`expired` tasks therefore cannot be resurrected through `task.start`.
- `tools/task-helpers.ts:54-60` only reports newly unblocked tasks when `t.status === "pending"`.

## R2-C5 — Rollback and no notification on persistence failure

**Verdict: PASS**

Source evidence:

- `tools/task.ts:137-165`:

```ts
async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
	const mutating = params.action !== "list";
	const previousTasks = cloneTasks(tasks);
	const previousNextId = nextId;
	let result;
	switch (params.action) {
		case "list": result = executeList(tasks, nextId); break;
		case "add": {
			const r = executeAdd(params.text, tasks, nextId);
			if ("nextId" in r) { nextId = r.nextId; result = r.result; } else { result = r; }
			break;
		}
		case "start": result = executeStart(params.id, tasks, nextId); break;
		case "done": result = executeDoneOrExpire("done", params.id, undefined, tasks, nextId); break;
		case "expire": result = executeDoneOrExpire("expire", params.id, params.reason, tasks, nextId); break;
		case "update_deps": result = executeUpdateDeps(params, tasks, nextId); break;
		case "clear": tasks = []; nextId = 1; result = executeClear(); break;
	}
	if (mutating) {
		try {
			persistState();
		} catch (err) {
			tasks = previousTasks;
			nextId = previousNextId;
			console.error(`[oh-my-pi task] Failed to persist task state: ${err instanceof Error ? err.message : String(err)}`);
			throw err;
		}
		notifyChange();
	}
```

- `tools/task.ts:91-92`:

```ts
const persistState = () => {
	pi.appendEntry(TASK_ENTRY_TYPE, { tasks: cloneTasks(tasks), nextId } satisfies TaskStateEntry);
```

Analysis:

- All actions except `list` are treated as mutating via `const mutating = params.action !== "list"`.
- Before dispatching a mutating action, the implementation snapshots both `tasks` and `nextId`.
- Persistence occurs before notification, inside `try`.
- If persistence throws, both `tasks` and `nextId` are restored from the snapshots, the error is logged, and the original error is rethrown.
- `notifyChange()` is after the `try/catch`; therefore UI notification is skipped on persistence failure and only occurs after successful append-entry persistence.

## Overall Verdict

PASS. R2-C3, R2-C4, and R2-C5 are fixed according to the inspected source evidence.
