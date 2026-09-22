import { Type } from "typebox";
import { Check } from "typebox/value";
import type { TaskRequest } from "./model.js";

const id = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const ids = Type.Array(id);
const listTypes = [
	"open",
	"closed",
	"in_progress",
	"ready",
	"blocked",
	"done",
	"expired",
] as const;
export const TaskListTypeSchema = Type.Union(
	listTypes.map((value) => Type.Literal(value)),
);
export const TaskCreationSchema = Type.Object(
	{
		key: Type.Optional(
			Type.String({
				description:
					"Call-local alias other items in this batch may reference in blockedBy",
			}),
		),
		text: Type.Optional(
			Type.String({
				description: "Task description; quote text containing spaces",
			}),
		),
		start: Type.Optional(
			Type.Boolean({
				description: "Mark the new task in_progress immediately if unblocked",
			}),
		),
		blockedBy: Type.Optional(
			Type.Array(Type.Union([Type.Number(), Type.String()]), {
				description: "Numeric task IDs or batch keys that block this new task",
			}),
		),
	},
	{ additionalProperties: false },
);
export const TaskRequestSchema = Type.Union([
	Type.Object(
		{
			action: Type.Literal("list"),
			type: Type.Optional(TaskListTypeSchema),
			limit: Type.Optional(
				Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
			),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("add"),
			text: Type.String(),
			start: Type.Optional(Type.Boolean()),
			blockedBy: Type.Optional(ids),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("add"),
			tasks: Type.Array(TaskCreationSchema, { minItems: 1 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{ action: Type.Literal("start"), id },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("done"),
			id,
			startNext: Type.Optional(Type.Union([id, Type.Array(id)])),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{ action: Type.Literal("expire"), id, reason: Type.String() },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("update_deps"),
			id,
			blocks: Type.Optional(ids),
			blockedBy: Type.Optional(ids),
		},
		{ additionalProperties: false },
	),
]);
export function parseTaskRequest(input: unknown): TaskRequest {
	if (!Check(TaskRequestSchema, input))
		throw new Error(
			"Invalid task request shape (model clear is not supported)",
		);
	const request: TaskRequest = input;
	if (
		request.action === "list" &&
		request.limit !== undefined &&
		request.type === undefined
	)
		throw new Error("limit requires an explicit type");
	return request;
}
