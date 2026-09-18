import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	type TaskBoundaryErrorDetails,
	taskBoundaryFailure,
} from "./failure.js";
import type { TaskOperation, TaskResultDetails } from "./model.js";
import { TaskCreationSchema, TaskListTypeSchema } from "./schema.js";

const id = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const TaskToolParameters = Type.Object(
	{
		action: Type.Union([
			Type.Literal("list"),
			Type.Literal("add"),
			Type.Literal("start"),
			Type.Literal("done"),
			Type.Literal("expire"),
			Type.Literal("update_deps"),
		]),
		text: Type.Optional(
			Type.String({
				description:
					"Task description (for: add); quote text containing spaces",
			}),
		),
		start: Type.Optional(
			Type.Boolean({
				description: "With add: mark the new task in_progress immediately",
			}),
		),
		blockedBy: Type.Optional(
			Type.Array(id, {
				description:
					"Existing task IDs that block this task (with add) or the target (with update_deps)",
			}),
		),
		blocks: Type.Optional(
			Type.Array(id, {
				description: "Task IDs this task blocks (for: update_deps)",
			}),
		),
		id: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: Number.MAX_SAFE_INTEGER,
				description: "Task ID (required for: start, done, expire, update_deps)",
			}),
		),
		reason: Type.Optional(
			Type.String({
				description:
					"Why the task is no longer relevant (required for: expire)",
			}),
		),
		tasks: Type.Optional(Type.Array(TaskCreationSchema, { minItems: 1 })),
		type: Type.Optional(TaskListTypeSchema),
		limit: Type.Optional(
			Type.Integer({
				minimum: 0,
				maximum: Number.MAX_SAFE_INTEGER,
				description: "Max rows to return (requires type)",
			}),
		),
	},
	{ additionalProperties: false },
);

export function createTaskToolDefinition(
	run: (input: unknown, context: ExtensionContext) => TaskOperation,
): ToolDefinition<
	typeof TaskToolParameters,
	TaskResultDetails | TaskBoundaryErrorDetails
> &
	Pick<AgentTool, "executionMode"> {
	return {
		name: "task",
		label: "Task",
		description:
			"Manage tasks: list, add, start, done, expire, update_deps. Non-task tools require an unblocked in_progress task; add {text, start: true, blockedBy?} creates and starts in one call. Add also accepts a tasks batch of {key?, text, start?, blockedBy?} where aliases reference batch items and numeric IDs reference existing tasks; batch errors skip only rejected items, edges or starts and report actual effects. List without type returns all open plus the ten latest closed; explicit type (open, closed, in_progress, ready, blocked, done, expired) supports an optional limit. Human-only clear is not a tool action.",
		executionMode: "sequential",
		parameters: TaskToolParameters,
		async execute(_id, input, _signal, _update, context) {
			try {
				return run(input, context).result;
			} catch {
				return taskBoundaryFailure();
			}
		},
	};
}
