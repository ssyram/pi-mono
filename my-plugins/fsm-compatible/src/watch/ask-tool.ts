const HC_QUESTION_DESCRIPTION = "Use this tool when you need to ask the user questions during execution. This allows you to:\n1. Gather user preferences or requirements\n2. Clarify ambiguous instructions\n3. Get decisions on implementation choices as you work\n4. Offer choices to the user about what direction to take.\n\nUsage notes:\n- When `custom` is enabled (default), a \"Type your own answer\" option is added automatically; don't include \"Other\" or catch-all options\n- Answers are returned as arrays of labels; set `multiple: true` to allow selecting more than one\n- If you recommend a specific option, make that the first option in the list and add \"(Recommended)\" at the end of the label\n";
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
	/** Unanswered-ask deadline (default 5s): shorter than the HTTP deadline. */
	readonly askTimeoutMs?: number;
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
		name: "question",
		label: "question",
		description: HC_QUESTION_DESCRIPTION,
		parameters: Type.Object({
			question: Type.String(),
			options: Type.Optional(Type.Array(Type.String())),
			header: Type.Optional(Type.String()),
		}),
		async execute(_id: string, params: unknown, _signal: AbortSignal | undefined, _onUpdate: undefined, ctx: ExtensionContext) {
			if (!registered) throw new Error("ask tool disabled");
			if (!isAskParams(params)) throw new Error("invalid question input");
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
				// Unanswered asks must fail fast, not pin the FSM gate open for
				// the full HTTP deadline — headless/CI runs have no human.
				const ask = params.options && params.options.length > 0
					? dialog.select(params.header ?? "Choose", [...params.options])
					: dialog.input(params.header ?? "Answer", "");
				const answer = await Promise.race([
					ask,
					new Promise<undefined>((resolve) => { setTimeout(() => resolve(undefined), deps.askTimeoutMs ?? 5000).unref?.(); }),
				]);
				if (answer === undefined) throw new Error("user cancelled");
				// Pi returns undefined when the user really cancels either dialog.
				if (answer === undefined) throw new Error("user cancelled");
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
