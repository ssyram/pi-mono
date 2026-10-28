import { Type } from "typebox";

const scriptTask = Type.Object({
	wakeUp: Type.Union([
		Type.Object({ kind: Type.Literal("never") }),
		Type.Object({ kind: Type.Literal("always"), prompt: Type.String() }),
		Type.Object({
			kind: Type.Literal("on-error"),
			prompt: Type.String(),
			aggregation: Type.Optional(
				Type.Union([Type.Literal("or"), Type.Literal("and")]),
			),
		}),
	]),
	scripts: Type.Array(
		Type.Object({
			path: Type.String(),
			cwd: Type.Optional(Type.String()),
			params: Type.Optional(Type.Array(Type.String())),
			timeoutSeconds: Type.Optional(
				Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]),
			),
		}),
	),
});

export const ScheduledWakeupParams = Type.Object({
	inhibitBoulder: Type.Optional(
		Type.Boolean({
			description:
				"Inhibit Boulder while this schedule is active. Optional for add.",
		}),
	),
	includeTimestamp: Type.Optional(
		Type.Boolean({
			description:
				"Include run-completed/report-sent timestamps in the delivered loop message. Default false (current behavior).",
		}),
	),
	action: Type.Union([
		Type.Literal("add"),
		Type.Literal("list"),
		Type.Literal("cancel"),
		Type.Literal("delete"),
	]),
	prompt: Type.Optional(
		Type.String({
			description:
				"Pure prompt task. Use either prompt or scriptTask, never both.",
		}),
	),
	name: Type.Optional(
		Type.String({
			description:
				"Optional display name shown in /loop list; unique names can replace ids in loop commands.",
		}),
	),
	scriptTask: Type.Optional(scriptTask),
	delay: Type.Optional(
		Type.String({
			description:
				"One-shot delay, e.g. 10s, 10min. Exactly one of delay/at/interval for add.",
		}),
	),
	at: Type.Optional(
		Type.String({
			description:
				"One-shot time, e.g. 12am tomorrow, 09:30 +08:00, ISO timestamp.",
		}),
	),
	interval: Type.Optional(
		Type.String({ description: "Recurring interval, e.g. 10min, 2h." }),
	),
	id: Type.Optional(
		Type.String({
			description:
				"Active task id or unique name for cancel; registration id or unique definition name for delete.",
		}),
	),
});

export type ToolParams = {
	action: "add" | "list" | "cancel" | "delete";
	inhibitBoulder?: boolean | undefined;
	includeTimestamp?: boolean | undefined;
	prompt?: string | undefined;
	name?: string | undefined;
	scriptTask?: unknown;
	delay?: string | undefined;
	at?: string | undefined;
	interval?: string | undefined;
	id?: string | undefined;
};
