import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerTaskCommand } from "../commands/task.js";
import { registerTaskGate } from "../hooks/task-gate.js";
import { registerTaskTool } from "../tools/task.js";
import { TASK_INFO_ENTRY_TYPE } from "../tools/task-info-entry.js";
import type { TaskBoundaryErrorDetails } from "../tools/task-system/failure.js";
import type { TaskResultDetails } from "../tools/task-system/model.js";
import { TASK_STATE_ENTRY_TYPE } from "../tools/task-system/state.js";

type AnyTaskResult = AgentToolResult<
	TaskResultDetails | TaskBoundaryErrorDetails
>;

function taskDetails(result: AnyTaskResult): TaskResultDetails {
	const details = result.details;
	assert.ok(
		details !== undefined && "tasks" in details,
		"expected task result details",
	);
	return details;
}

interface RegisteredTaskTool {
	name: string;
	executionMode?: string;
	renderCall?: unknown;
	renderResult?: unknown;
	execute(
		id: string,
		input: unknown,
		signal: AbortSignal,
		onUpdate: () => void,
		context: ExtensionContext,
	): Promise<AnyTaskResult>;
}

function signal(): AbortSignal {
	return new AbortController().signal;
}

function noop(): void {}

function taskHarness(options?: {
	appendEntry?: (customType: string, data: unknown) => void;
	allTools?: string[];
}) {
	const tools: RegisteredTaskTool[] = [];
	const handlers = new Map<
		string,
		(event: unknown, context: ExtensionContext) => unknown
	>();
	const entries: Array<{ customType: string; data: unknown }> = [];
	const append =
		options?.appendEntry ??
		((customType: string, data: unknown) => {
			entries.push({ customType, data });
		});
	const pi = {
		registerTool: (definition: unknown) =>
			tools.push(definition as RegisteredTaskTool),
		on: (
			event: string,
			handler: (event: unknown, context: ExtensionContext) => unknown,
		) => handlers.set(event, handler),
		appendEntry: (customType: string, data: unknown) =>
			append(customType, data),
		registerEntryRenderer: noop,
		registerCommand: noop,
		getActiveTools: () => options?.allTools ?? ["task", "read"],
		getAllTools: () =>
			(options?.allTools ?? ["task", "read"]).map((name) => ({ name })),
	} as unknown as ExtensionAPI;
	const branch: unknown[] = [];
	const history: unknown[] = [];
	let branchError: Error | undefined;
	const context = {
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => {
				if (branchError) throw branchError;
				return branch;
			},
			getEntries: () => {
				if (branchError) throw branchError;
				return history;
			},
		},
	} as ExtensionContext;
	const stateEntries = () =>
		entries.filter((entry) => entry.customType === TASK_STATE_ENTRY_TYPE);
	return {
		pi,
		tools,
		handlers,
		entries,
		branch,
		history,
		context,
		stateEntries,
		failBranch(error?: Error) {
			branchError = error;
		},
	};
}

describe("task tool integration", () => {
	it("registers the sequential task tool and persists each mutation once", async () => {
		const h = taskHarness();
		const handle = registerTaskTool(h.pi);
		const definition = h.tools[0];
		assert.ok(definition, "task tool was not registered");
		assert.equal(definition.name, "task");
		assert.equal(definition.executionMode, "sequential");
		assert.ok(definition.renderCall);
		assert.equal(definition.renderResult, undefined);

		const added = await definition.execute(
			"c1",
			{ action: "add", text: "写文档" },
			signal(),
			noop,
			h.context,
		);
		assert.equal(taskDetails(added).error, undefined);
		assert.equal(taskDetails(added).tasks[0]?.id, 1);
		assert.equal(h.stateEntries().length, 1);
		assert.equal((h.stateEntries()[0]?.data as { nextId: number }).nextId, 2);
		const summary = handle.getTaskState(h.context);
		assert.equal(summary.tasks.length, 1);
		assert.equal(summary.pendingCount, 1);
	});

	it("shares one owner between human commands and model operations", async () => {
		const h = taskHarness();
		const handle = registerTaskTool(h.pi);
		const human = handle.runHumanTaskCommand(
			'add "人工任务" --start',
			h.context,
		);
		assert.equal(taskDetails(human).error, undefined);
		assert.equal(taskDetails(human).tasks[0]?.status, "in_progress");
		assert.equal(handle.getTaskState(h.context).inProgressCount, 1);
		const listed = await h.tools[0].execute(
			"c2",
			{ action: "list" },
			signal(),
			noop,
			h.context,
		);
		assert.match(
			String(
				listed.content[0] && listed.content[0].type === "text"
					? listed.content[0].text
					: "",
			),
			/#1/,
		);
		// Only the human add mutated state; the model list persists nothing.
		assert.equal(h.stateEntries().length, 1);
	});

	it("reports restore failures explicitly and unblocks on the next retry", async () => {
		const h = taskHarness();
		const handle = registerTaskTool(h.pi);
		h.failBranch(new Error("history unreadable"));
		const failed = await h.tools[0].execute(
			"c1",
			{ action: "add", text: "x" },
			signal(),
			noop,
			h.context,
		);
		assert.match(String(taskDetails(failed).error ?? ""), /not restored/);
		assert.equal(handle.getTaskState(h.context).tasks.length, 0);
		const humanFailed = handle.runHumanTaskCommand('add "y"', h.context);
		assert.match(String(humanFailed.details?.error ?? ""), /not restored/);

		h.failBranch(undefined);
		const ok = await h.tools[0].execute(
			"c3",
			{ action: "add", text: "z" },
			signal(),
			noop,
			h.context,
		);
		assert.equal(taskDetails(ok).error, undefined);
		assert.equal(taskDetails(ok).tasks[0]?.id, 1);
	});

	it("persists nothing when no effect was accepted", async () => {
		const h = taskHarness();
		registerTaskTool(h.pi);
		const rejected = await h.tools[0].execute(
			"c1",
			{ action: "start", id: 99 },
			signal(),
			noop,
			h.context,
		);
		assert.match(String(taskDetails(rejected).error ?? ""), /99/);
		const listed = await h.tools[0].execute(
			"c2",
			{ action: "list" },
			signal(),
			noop,
			h.context,
		);
		assert.equal(taskDetails(listed).error, undefined);
		assert.equal(h.stateEntries().length, 0);
	});

	it("returns an explicit error on persistence failure and keeps ID reservations", async () => {
		let failAppend = false;
		const h = taskHarness({
			appendEntry: (customType, data) => {
				if (failAppend) throw new Error("disk full");
				h.entries.push({ customType, data });
			},
		});
		const handle = registerTaskTool(h.pi);
		failAppend = true;
		const failed = await h.tools[0].execute(
			"c1",
			{ action: "add", text: "a" },
			signal(),
			noop,
			h.context,
		);
		assert.match(String(taskDetails(failed).error ?? ""), /persistence failed/);
		assert.equal(handle.getTaskState(h.context).tasks.length, 0);
		failAppend = false;
		const ok = await h.tools[0].execute(
			"c2",
			{ action: "add", text: "b" },
			signal(),
			noop,
			h.context,
		);
		assert.equal(taskDetails(ok).error, undefined);
		assert.equal(taskDetails(ok).tasks[0]?.id, 2);
	});

	it("contains notification callback failures without corrupting committed results", async () => {
		const h = taskHarness();
		const handle = registerTaskTool(h.pi);
		handle.setOnTaskChange(() => {
			throw new Error("widget boom");
		});
		const added = await h.tools[0].execute(
			"c1",
			{ action: "add", text: "x" },
			signal(),
			noop,
			h.context,
		);
		assert.equal(taskDetails(added).error, undefined);
		assert.equal(taskDetails(added).tasks[0]?.id, 1);
		assert.equal(h.stateEntries().length, 1);
	});
});

describe("task gate integration", () => {
	it("exempts only task and requires an unblocked in-progress task", () => {
		const h = taskHarness();
		const handle = registerTaskTool(h.pi);
		registerTaskGate(h.pi, handle.getTaskState);
		const gate = h.handlers.get("tool_call");
		assert.ok(gate, "tool_call gate was not registered");
		assert.equal(gate({ toolName: "task" }, h.context), undefined);
		const blocked = gate({ toolName: "read" }, h.context) as { block: boolean };
		assert.equal(blocked.block, true);

		handle.runHumanTaskCommand('add "进行中" --start', h.context);
		assert.equal(gate({ toolName: "read" }, h.context), undefined);

		handle.runHumanTaskCommand('add "前置"', h.context);
		handle.runHumanTaskCommand("modify 1 --blocked-by 2", h.context);
		const demoted = gate({ toolName: "read" }, h.context) as { block: boolean };
		assert.equal(demoted.block, true);
	});

	it("reports a missing task capability without throwing", async () => {
		const h = taskHarness({ allTools: ["read"] });
		registerTaskTool(h.pi);
		registerTaskGate(h.pi, () => ({ tasks: [] }));
		const sessionStart = h.handlers.get("session_start");
		assert.ok(sessionStart);
		await sessionStart(undefined, h.context);
	});
});

describe("task command routing", () => {
	function commandHarness(options?: {
		appendEntry?: (customType: string, data: unknown) => void;
	}) {
		const entries: Array<{ customType: string; data: unknown }> = [];
		let handler:
			| ((args: string, ctx: ExtensionContext) => Promise<void>)
			| undefined;
		const pi = {
			registerEntryRenderer: noop,
			registerCommand: (
				_name: string,
				command: {
					handler: (args: string, ctx: ExtensionContext) => Promise<void>;
				},
			) => {
				handler = command.handler;
			},
			appendEntry: (customType: string, data: unknown) => {
				if (options?.appendEntry) return options.appendEntry(customType, data);
				entries.push({ customType, data });
			},
			on: noop,
		} as unknown as ExtensionAPI;
		return {
			pi,
			entries,
			get handler() {
				assert.ok(handler, "task command was not registered");
				return handler;
			},
		};
	}

	function humanResult(error?: string): AnyTaskResult {
		return {
			content: [{ type: "text", text: error ? `Error: ${error}` : "ok" }],
			details: {
				action: "add",
				tasks: [],
				rows: [],
				nextId: 1,
				outcomes: [],
				partial: false,
				error,
			},
		};
	}

	it("routes human roots with the entire original string", async () => {
		const calls: string[] = [];
		const h = commandHarness();
		registerTaskCommand(h.pi, {
			getTasks: () => [],
			setWidgetVisibility: noop,
			runHumanTaskCommand: (args) => {
				calls.push(args);
				return humanResult();
			},
		});
		const ctx = {} as ExtensionContext;
		await h.handler('add "hello world" --start', ctx);
		await h.handler("modify 3 --status done", ctx);
		await h.handler("list --type blocked", ctx);
		await h.handler("clear", ctx);
		assert.deepEqual(calls, [
			'add "hello world" --start',
			"modify 3 --status done",
			"list --type blocked",
			"clear",
		]);
		const info = h.entries.filter(
			(entry) => entry.customType === TASK_INFO_ENTRY_TYPE,
		);
		assert.equal(info.length, 4);
		assert.equal((info[0]?.data as { tone: string }).tone, "info");
	});

	it("keeps legacy roots on the old flow and never calls the human callback", async () => {
		const calls: string[] = [];
		const h = commandHarness();
		registerTaskCommand(h.pi, {
			getTasks: () => [],
			setWidgetVisibility: noop,
			runHumanTaskCommand: (args) => {
				calls.push(args);
				return humanResult();
			},
		});
		const ctx = {} as ExtensionContext;
		await h.handler("show off", ctx);
		await h.handler("", ctx);
		await h.handler("info", ctx);
		await h.handler("bogus", ctx);
		assert.deepEqual(calls, []);
		const texts = h.entries
			.filter((entry) => entry.customType === TASK_INFO_ENTRY_TYPE)
			.map((entry) => String((entry.data as { text: string }).text));
		assert.match(texts[1] ?? "", /\/task add/);
		assert.match(texts[3] ?? "", /Unknown or incomplete/);
	});

	it("renders human errors as warnings and contains output failures", async () => {
		const h = commandHarness();
		registerTaskCommand(h.pi, {
			getTasks: () => [],
			setWidgetVisibility: noop,
			runHumanTaskCommand: () => humanResult("Task #99 not found"),
		});
		await h.handler("modify 99 --status done", {} as ExtensionContext);
		const last = h.entries.at(-1)?.data as { tone: string; text: string };
		assert.equal(last.tone, "warning");
		assert.match(last.text, /Task #99 not found/);

		const failing = commandHarness({
			appendEntry: () => {
				throw new Error("log unavailable");
			},
		});
		registerTaskCommand(failing.pi, {
			getTasks: () => [],
			setWidgetVisibility: noop,
			runHumanTaskCommand: () => humanResult(),
		});
		await failing.handler("list", {} as ExtensionContext);
	});

	it("contains completion installation failures in session_start", async () => {
		const handlers = new Map<
			string,
			(event: unknown, context: ExtensionContext) => unknown
		>();
		const pi = {
			registerEntryRenderer: noop,
			registerCommand: noop,
			appendEntry: noop,
			on: (
				event: string,
				handler: (event: unknown, context: ExtensionContext) => unknown,
			) => handlers.set(event, handler),
		} as unknown as ExtensionAPI;
		registerTaskCommand(pi, {
			getTasks: () => [],
			setWidgetVisibility: noop,
			runHumanTaskCommand: () => {
				throw new Error("unused in this test");
			},
		});
		const ctx = {
			ui: {
				addAutocompleteProvider() {
					throw new Error("no editor");
				},
			},
		} as unknown as ExtensionContext;
		const sessionStart = handlers.get("session_start");
		assert.ok(sessionStart, "session_start was not registered");
		await sessionStart({}, ctx);
	});
});

describe("restricted profiles expose the task tool", () => {
	it("adds task to every explicit tool list and updates sisyphus-junior", async () => {
		const agentsDirectory = join(import.meta.dirname, "..", "agents");
		const restricted = [
			"adversarial-auditor.md",
			"confirmation-auditor.md",
			"crash-safety-auditor.md",
			"cross-boundary-auditor.md",
			"explore.md",
			"functional-correctness-auditor.md",
			"metis.md",
			"multimodal-looker.md",
			"oracle.md",
			"resource-auditor.md",
			"spec-impl-auditor.md",
			"workflow-auditor.md",
		];
		for (const name of restricted) {
			const text = await readFile(join(agentsDirectory, name), "utf8");
			assert.match(
				text,
				/^tools:.*(?:^|,)\s*task\b/m,
				`${name} must list task`,
			);
		}
		const junior = await readFile(
			join(agentsDirectory, "sisyphus-junior.md"),
			"utf8",
		);
		assert.ok(!junior.includes("skip todo tracking"));
		assert.match(junior, /Task discipline applies in every session/);
	});
});
