import { loopErrorMessage } from "../loop-error-message.js";
import { formatActiveTasks } from "./format-list.js";
import type { LoopV2Core } from "./loop-core.js";
import type { ActiveTask, TaskInput, TaskSchedule } from "./model.js";import { readTaskName } from "./model.js";
import {
	activeTaskCandidates,
	registrationCandidates,
	resolveTarget,
} from "./resolve-target.js";
import { readTaskContent } from "./task-content.js";
import { validOnceTime } from "./valid-once-time.js";

export type AiSessionActionResult = {
	ok: boolean;
	message: string;
	active: readonly ActiveTask[] | null;
	activeError?: string;
};

export type RunTerminationPort = {
	formatOverview(active: readonly ActiveTask[]): string;
	terminateTaskRuns(taskId: string): Promise<{ killed: number; retracted: number }>;
};

/** This is the only surface intended for a future AI tool registration. */
export class AiSessionActions {
	private readonly core: LoopV2Core;
	private readonly runs: RunTerminationPort | undefined;

	constructor(core: LoopV2Core, runs?: RunTerminationPort) {
		this.core = core;
		this.runs = runs;
	}

	async execute(input: unknown): Promise<AiSessionActionResult> {
		try {
			if (!isRecord(input))
				return this.result(false, "Error: request must be an object.");
			if (Object.hasOwn(input, "scope") || Object.hasOwn(input, "force"))
				return this.result(
					false,
					"Error: AI actions are session-scoped and do not accept scope or force.",
				);
			switch (input.action) {
				case "add":
					return this.add(input);
				case "list":
					return this.list();
				case "cancel":
					return await this.cancel(input);
				case "delete":
					return this.delete(input);
				default:
					return this.result(
						false,
						"Error: action must be add, list, cancel, or delete.",
					);
			}
		} catch (error) {
			return this.result(
				false,
				`Error: ${errorMessage(error)}. State may already have changed.`,
			);
		}
	}

	private list(): AiSessionActionResult {
		try {
			const active = this.core.listActive();
			const message = this.runs
				? this.runs.formatOverview(active)
				: formatActiveTasks(active);
			return { ok: true, message, active };
		} catch (error) {
			const activeError = errorMessage(error);
			return {
				ok: false,
				message: `Error: ${activeError}. State may already have changed.`,
				active: null,
				activeError,
			};
		}
	}

	private add(input: Record<string, unknown>): AiSessionActionResult {
		const task = parseTaskInput(input);
		if (task === undefined)
			return this.result(
				false,
				"Error: add requires a valid prompt or prepared scriptTask and a valid schedule.",
			);
		return this.result(
			true,
			`Added session task ${this.core.createSessionTask(task).id}${task.name === undefined ? "" : ` (${task.name})`}.`,
		);
	}

	private async cancel(input: Record<string, unknown>): Promise<AiSessionActionResult> {
		if (!text(input.id))
			return this.result(false, "Error: cancel requires an active task id.");
		const resolution = resolveTarget(input.id, activeTaskCandidates(this.core));
		if (!resolution.ok)
			return this.result(false, `Error: cancel ${resolution.message}.`);
		const outcome = this.core.cancelActive(resolution.id);
		const termination = await this.runs?.terminateTaskRuns(resolution.id);
		if (
			outcome !== "cancelled" &&
			(termination === undefined ||
				termination.killed + termination.retracted === 0)
		)
			return this.result(false, `Error: ${resolution.id} is ${outcome}.`);
		const head =
			outcome === "cancelled"
				? `Cancelled ${resolution.id}.`
				: `Cancelled runs of ${resolution.id}.`;
		const parts: string[] = [];
		if (termination !== undefined && termination.killed > 0)
			parts.push(`Killed ${termination.killed} running batch${termination.killed === 1 ? "" : "es"}.`);
		if (termination !== undefined && termination.retracted > 0)
			parts.push(`Retracted ${termination.retracted} pending deliver${termination.retracted === 1 ? "y" : "ies"}.`);
		return this.result(true, parts.length === 0 ? head : `${head} ${parts.join(" ")}`);
	}

	private delete(input: Record<string, unknown>): AiSessionActionResult {
		if (!text(input.id))
			return this.result(false, "Error: delete requires a registration id.");
		const resolution = resolveTarget(
			input.id,
			registrationCandidates(this.core),
		);
		if (!resolution.ok)
			return this.result(false, `Error: delete ${resolution.message}.`);
		const outcome = this.core.deleteRegistrationDefinition(resolution.id);
		return outcome.kind === "deleted"
			? this.result(true, `Deleted shared definition for ${resolution.id}.`)
			: this.result(false, `Error: delete is ${outcome.kind}.`);
	}

	private result(
		ok: boolean,
		message: string,
		requireActive = false,
	): AiSessionActionResult {
		try {
			return { ok, message, active: this.core.listActive() };
		} catch (error) {
			const activeError = errorMessage(error);
			return {
				ok: requireActive ? false : ok,
				message: `${message} Active state is unavailable: ${activeError}.`,
				active: null,
				activeError,
			};
		}
	}
}

function parseTaskInput(input: Record<string, unknown>): TaskInput | undefined {
	const content = readTaskContent(input);
	if (content === undefined) return undefined;
	if (
		input.inhibitBoulder !== undefined &&
		typeof input.inhibitBoulder !== "boolean"
	)
		return undefined;
	const schedule = parseSchedule(input.schedule);
	if (schedule === undefined) return undefined;
	const inhibitBoulder = input.inhibitBoulder === true ? true : undefined;
	const name = readTaskName(input.name);
	return {
		...content,
		schedule,
		...(inhibitBoulder !== undefined ? { inhibitBoulder } : {}),
		...(name !== undefined ? { name } : {}),
	};
}
function parseSchedule(value: unknown): TaskSchedule | undefined {
	if (!isRecord(value) || typeof value.kind !== "string") return undefined;
	if (
		value.kind === "once" &&
		positive(value.runAt) &&
		validOnceTime(value.runAt)
	)
		return { kind: "once", runAt: value.runAt };
	if (value.kind === "interval" && positive(value.intervalMs))
		return { kind: "interval", intervalMs: value.intervalMs };
	return undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
function text(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function errorMessage(error: unknown): string {
	return loopErrorMessage(error);
}
