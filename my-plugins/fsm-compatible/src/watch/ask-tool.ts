import { readFileSync } from "node:fs";
import { join } from "node:path";

let questionSchema: Record<string, unknown> | undefined;
function loadQuestionSchema(): Record<string, unknown> {
	if (!questionSchema) {
		try {
			const raw = readFileSync(join(import.meta.dirname, "../../data/hc-tool-schemas.json"), "utf8");
			questionSchema = (JSON.parse(raw) as Record<string, { parameters: Record<string, unknown> }>).question?.parameters ?? {};
		} catch {
			questionSchema = {};
		}
	}
	return questionSchema!;
}

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

interface AskQuestion {
	question: string;
	header?: string;
	options?: readonly { label: string; description?: string }[];
	multiple?: boolean;
}

interface AskParams {
	questions: readonly AskQuestion[];
}

function isAskParams(value: unknown): value is AskParams {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.questions) || record.questions.length === 0) return false;
	return record.questions.every((entry) => entry && typeof entry === "object"
		&& typeof (entry as AskQuestion).question === "string" && (entry as AskQuestion).question.length > 0);
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
		parameters: loadQuestionSchema() as never,
		async execute(_id: string, params: unknown, _signal: AbortSignal | undefined, _onUpdate: undefined, ctx: ExtensionContext) {
			if (!registered) throw new Error("ask tool disabled");
			if (!isAskParams(params)) throw new Error("invalid question input");
			const current = deps.binding();
			if (!current) throw new Error("runtime not ready");
			// Dual harness answers deterministically: PLOT_QUESTION_REPLIES maps
			// each question text to its chosen option label (or free text).
			const replies = (() => {
				try { return JSON.parse(process.env.PLOT_QUESTION_REPLIES ?? "{}") as Record<string, string>; } catch { return {}; }
			})();
			if (Object.keys(replies).length > 0) {
				const answered = params.questions.map((entry) => `"${entry.question}"="${replies[entry.question] ?? ""}"`).join(" ");
				return { content: [{ type: "text" as const, text: `User has answered your questions: ${answered}. You can now continue with the user's answers in mind.` }],
					details: { title: `Asked ${params.questions.length} question`, metadata: { answers: params.questions.map((entry) => [replies[entry.question] ?? ""]) } } };
			}
			const dialog = ctx.ui;
			if (!dialog || typeof dialog.select !== "function" || typeof dialog.input !== "function") {
				return { content: [{ type: "text" as const, text: "AskUserQuestion unavailable: no interactive UI in this mode." }], isError: true };
			}
			// Step P1: wait state is set before the human dialog; the verdict-time suppress already happened.
			deps.waitState.active = true;
			deps.waitState.since = Date.now();
			deps.waitState.question = params.questions[0]?.question ?? "";
			try {
				// Unanswered asks must fail fast, not pin the FSM gate open for
				// the full HTTP deadline — headless/CI runs have no human.
				const first = params.questions[0]!;
				const labels = first.options?.map((option) => option.label) ?? [];
				const ask = labels.length > 0
					? dialog.select(first.header ?? "Choose", labels)
					: dialog.input(first.header ?? "Answer", "");
				const answer = await Promise.race([
					ask,
					new Promise<undefined>((resolve) => { setTimeout(() => resolve(undefined), deps.askTimeoutMs ?? 5000).unref?.(); }),
				]);
				if (answer === undefined) throw new Error("user cancelled");
				return { content: [{ type: "text" as const, text: `User has answered your questions: "${first.question}"="${answer}". You can now continue with the user's answers in mind.` }] };
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
