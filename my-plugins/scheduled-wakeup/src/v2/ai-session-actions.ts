import type { ActiveTask, TaskInput, TaskSchedule } from "./model.js";
import { LoopV2Core } from "./loop-core.js";

export type AiSessionActionResult = { ok: boolean; message: string; active: readonly ActiveTask[] };

/** This is the only surface intended for a future AI tool registration. */
export class AiSessionActions {
	private readonly core: LoopV2Core;

	constructor(core: LoopV2Core) { this.core = core; }

	execute(input: unknown): AiSessionActionResult {
		if (!isRecord(input)) return this.result(false, "Error: request must be an object.");
		if (Object.hasOwn(input, "scope") || Object.hasOwn(input, "force")) return this.result(false, "Error: AI actions are session-scoped and do not accept scope or force.");
		switch (input.action) {
			case "add": return this.add(input);
			case "list": return this.result(true, "Listed active session work.");
			case "cancel": return this.cancel(input);
			case "delete": return this.delete(input);
			default: return this.result(false, "Error: action must be add, list, cancel, or delete.");
		}
	}

	private add(input: Record<string, unknown>): AiSessionActionResult {
		const task = parseTaskInput(input);
		if (task === undefined) return this.result(false, "Error: add requires a nonempty prompt and a valid schedule.");
		try { return this.result(true, `Added session task ${this.core.createSessionTask(task).id}.`); }
		catch (error) { return this.result(false, `Error: ${errorMessage(error)}`); }
	}

	private cancel(input: Record<string, unknown>): AiSessionActionResult {
		if (!text(input.id)) return this.result(false, "Error: cancel requires an active task id.");
		const outcome = this.core.cancelActive(input.id);
		return outcome === "cancelled" ? this.result(true, `Cancelled ${input.id}.`) : this.result(false, `Error: ${input.id} is ${outcome}.`);
	}

	private delete(input: Record<string, unknown>): AiSessionActionResult {
		if (!text(input.id)) return this.result(false, "Error: delete requires a registration id.");
		const outcome = this.core.deleteRegistrationDefinition(input.id);
		return outcome.kind === "deleted" ? this.result(true, `Deleted shared definition for ${input.id}.`) : this.result(false, `Error: delete is ${outcome.kind}.`);
	}

	private result(ok: boolean, message: string): AiSessionActionResult { return { ok, message, active: this.core.listActive() }; }
}

function parseTaskInput(input: Record<string, unknown>): TaskInput | undefined {
	if (!text(input.prompt)) return undefined;
	const schedule = parseSchedule(input.schedule);
	return schedule === undefined ? undefined : { prompt: input.prompt, schedule };
}
function parseSchedule(value: unknown): TaskSchedule | undefined {
	if (!isRecord(value) || typeof value.kind !== "string") return undefined;
	if (value.kind === "once" && positive(value.runAt)) return { kind: "once", runAt: value.runAt };
	if (value.kind === "interval" && positive(value.intervalMs)) return { kind: "interval", intervalMs: value.intervalMs };
	return undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
