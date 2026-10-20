import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DaemonRequester } from "../broker/daemon-request.ts";
import { moveGate } from "../gates/gate-moves.ts";
import type { GateBinding } from "../gates/permission-gate.ts";

export interface WaitState {
	active: boolean;
	since: number;
	question: string;
}

export function createWaitState(): WaitState {
	return { active: false, since: 0, question: "" };
}

export interface AskToolDeps {
	readonly request: DaemonRequester;
	readonly binding: () => GateBinding | undefined;
	readonly waitState: WaitState;
	readonly timeoutMs: number;
}

interface AskParams {
	question: string;
	options?: readonly string[];
	header?: string;
}

function isAskParams(value: unknown): value is AskParams {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (typeof record.question !== "string" || !record.question) return false;
	if (record.options !== undefined && (!Array.isArray(record.options)
		|| record.options.some((option) => typeof option !== "string"))) return false;
	if (record.header !== undefined && typeof record.header !== "string") return false;
	return true;
}

/**
 * The FSM question tool. The main-gate suppress already happened at the
 * permission verdict (bisection); this tool only owns the wait state and the
 * ask-end release when the answer (or cancellation) arrives.
 */
export function registerAskTool(pi: ExtensionAPI, deps: AskToolDeps): () => void {
	let registered = true;
	pi.registerTool({
		name: "AskUserQuestion",
		label: "AskUserQuestion",
		description: "Ask the human a task question and wait for the answer.",
		parameters: Type.Object({
			question: Type.String(),
			options: Type.Optional(Type.Array(Type.String())),
			header: Type.Optional(Type.String()),
		}),
		async execute(_id: string, params: unknown, _signal: AbortSignal | undefined, _onUpdate: undefined, ctx: ExtensionContext) {
			if (!registered) throw new Error("ask tool disabled");
			if (!isAskParams(params)) throw new Error("invalid AskUserQuestion input");
			const current = deps.binding();
			if (!current) throw new Error("runtime not ready");
			const dialog = ctx.ui;
			if (!dialog || typeof dialog.select !== "function" || typeof dialog.input !== "function") {
				return { content: [{ type: "text" as const, text: "AskUserQuestion unavailable: no interactive UI in this mode." }], isError: true };
			}
			// Step P1: wait state is set before the human dialog; the verdict-time suppress already happened.
			deps.waitState.active = true;
			deps.waitState.since = Date.now();
			deps.waitState.question = params.question;
			try {
				let answer: string;
				if (params.options && params.options.length > 0) {
					const selected = await dialog.select(params.header ?? "Choose", [...params.options]);
					answer = typeof selected === "string" ? selected : String(selected ?? "");
				} else {
					const typed = await dialog.input(params.header ?? "Answer", "");
					answer = typeof typed === "string" ? typed : String(typed ?? "");
				}
				return { content: [{ type: "text" as const, text: answer }] };
			} catch (error) {
				return { content: [{ type: "text" as const, text: `question cancelled: ${error instanceof Error ? error.message : "unknown"}` }], isError: true };
			} finally {
				// Step P1 (release): after the real answer/cancellation.
				deps.waitState.active = false;
				// ask-end release (best-effort) once the answer/cancellation is real.
				void moveGate(deps.request, current, false, "ask-end", Date.now() + deps.timeoutMs);
			}
		},
	} as never);
	return () => { registered = false; };
}
