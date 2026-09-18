import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { registerTaskTool } from "../tools/task.js";
import type { Task } from "../tools/task-types.js";

type EventHandler = (event: unknown, context: ExtensionContext) => unknown;
type TaskAction = "list" | "add" | "start" | "done" | "expire" | "clear" | "update_deps";
interface CapturedTaskTool {
	execute(
		toolCallId: string,
		params: { action: TaskAction; text?: string; id?: number; reason?: string },
		signal: undefined,
		onUpdate: undefined,
		context: ExtensionContext,
	): Promise<unknown>;
}

function task(id: number, text: string): Task {
	return {
		id,
		text,
		status: "pending",
		blocks: [],
		blockedBy: [],
		createdAt: id,
		updatedAt: id,
	};
}

function taskEntry(id: string, tasks: Task[], nextId: number): SessionEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		customType: "omp-task-state",
		data: { tasks, nextId },
	} as SessionEntry;
}

let sessionCounter = 0;

function session(branchEntries: SessionEntry[], allEntries = branchEntries): {
	context: ExtensionContext;
	branch: SessionEntry[];
	allReadCount(): number;
} {
	const branch = [...branchEntries];
	let allReads = 0;
	sessionCounter += 1;
	const sessionId = `session-${sessionCounter}`;
	const sessionManager = {
		getSessionId: () => sessionId,
		getBranch: () => branch,
		getEntries: () => {
			allReads += 1;
			return allEntries;
		},
	};
	return {
		context: { sessionManager } as unknown as ExtensionContext,
		branch,
		allReadCount: () => allReads,
	};
}

describe("task session state", () => {
	it("isolates identities and reloads only the current branch", async () => {
		const handlers = new Map<string, EventHandler[]>();
		const appended: Array<{ customType: string; data: unknown }> = [];
		let tool: CapturedTaskTool | undefined;
		const pi = {
			on: (event: string, handler: EventHandler) => {
				const eventHandlers = handlers.get(event) ?? [];
				eventHandlers.push(handler);
				handlers.set(event, eventHandlers);
			},
			registerTool: (definition: CapturedTaskTool) => {
				tool = definition;
			},
			appendEntry: (customType: string, data: unknown) => appended.push({ customType, data }),
		} as unknown as ExtensionAPI;
		const handle = registerTaskTool(pi);
		const siblingEntry = taskEntry("sibling", [task(99, "sibling-only")], 100);
		const first = session([taskEntry("first", [task(1, "first")], 2)], [siblingEntry]);
		const second = session([taskEntry("second", [task(2, "second")], 3)]);
		const empty = session([], [siblingEntry]);
		const changes: Array<{ tasks: Task[]; context: ExtensionContext }> = [];
		handle.setOnTaskChange((tasks, context) => changes.push({ tasks, context }));
		const emit = async (event: string, context: ExtensionContext): Promise<void> => {
			for (const handler of handlers.get(event) ?? []) await handler({}, context);
		};

		await emit("session_start", first.context);
		await emit("session_start", second.context);
		await emit("session_start", empty.context);
		assert.deepEqual(handle.getTaskState(first.context).tasks.map((item) => item.id), [1]);
		assert.deepEqual(handle.getTaskState(second.context).tasks.map((item) => item.id), [2]);
		assert.deepEqual(handle.getTaskState(empty.context).tasks, []);
		// Restoration consults the session history once to raise the allocation floor (sibling nextId 100).
		assert.equal(first.allReadCount(), 1);
		assert.equal(empty.allReadCount(), 1);

		if (!tool) throw new Error("task tool was not registered");
		await tool.execute("call", { action: "add", text: "first second task" }, undefined, undefined, first.context);
		// The sibling snapshot in session history raises the allocation floor, so the new task takes id 100.
		assert.deepEqual(handle.getTaskState(first.context).tasks.map((item) => item.id), [1, 100]);
		assert.deepEqual(handle.getTaskState(second.context).tasks.map((item) => item.id), [2]);
		assert.deepEqual(handle.getTaskState(empty.context).tasks, []);
		assert.equal(changes.at(-1)?.context, first.context);
		assert.deepEqual(changes.at(-1)?.tasks.map((item) => item.id), [1, 100]);
		assert.equal(appended.at(-1)?.customType, "omp-task-state");
		assert.equal(first.allReadCount(), 1);

		first.branch.splice(0);
		await emit("session_tree", first.context);
		assert.deepEqual(handle.getTaskState(first.context).tasks, []);
		await emit("session_shutdown", second.context);
		assert.deepEqual(handle.getTaskState(second.context).tasks, []);
	});
});
