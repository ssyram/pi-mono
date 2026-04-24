import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { boundLlmInput, formatTruncationNotice, parseMaxChars } from "../bounded-llm-input.js";
import { parseReviseArgs } from "./parse-revise-args.js";
import { handleCompletedRevision, createReviseInstruction } from "./revision-completion.js";
import { createRevisionRenderer } from "./revision-renderer.js";
import { REVISION_TYPE } from "./revision-state.js";
import { clearRevisionSessionState, getRevisionSessionState, type RevisionSessionState } from "./revision-session-state.js";
import { buildEntriesText, collectReplacedEntries, findTargetUserEntry } from "./session-text.js";

function buildBoundedOriginalText(originalText: string, maxChars: number): string {
	const bounded = boundLlmInput(originalText, maxChars);
	return bounded.truncated ? `${formatTruncationNotice(bounded.originalLength, maxChars)}\n\n${bounded.text}` : bounded.text;
}

const revisionStates = new Map<string, RevisionSessionState>();

export default async function revision(pi: ExtensionAPI): Promise<void> {
	pi.registerFlag("revision-max-recap-chars", {
		type: "string",
		description: "Maximum source characters used for revision recap generation",
		default: "10240",
	});

	pi.registerMessageRenderer(REVISION_TYPE, createRevisionRenderer());

	pi.on("session_start", async (_event, ctx) => {
		clearRevisionSessionState(revisionStates, ctx.sessionManager.getSessionId());
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const state = getRevisionSessionState(revisionStates, ctx.sessionManager.getSessionId());
		const request = state.request;
		if (state.status !== "generating" || !request) return;
		return {
			systemPrompt: `${ctx.getSystemPrompt()}\n\nYou are replacing an earlier assistant response. Use this omitted source material as ground truth for the replacement:\n\n${request.boundedOriginalText}`,
		};
	});

	pi.on("message_end", async (event, ctx) => {
		const state = getRevisionSessionState(revisionStates, ctx.sessionManager.getSessionId());
		if (state.status !== "generating") return;
		if (event.message.role === "assistant") state.generatedMessages.push(event.message);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await handleCompletedRevision({
			ctx,
			sessionStates: revisionStates,
			maxChars: parseMaxChars(pi.getFlag("revision-max-recap-chars")),
		});
	});

	pi.registerCommand("revise", {
		description: "Revise a previous assistant response. Usage: /revise [--upto N] [--no-summary | --visible-summary] prompt",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			let options;
			try {
				options = parseReviseArgs(args);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			const sessionId = ctx.sessionManager.getSessionId();
			const state = getRevisionSessionState(revisionStates, sessionId);
			if (state.status === "generating") {
				ctx.ui.notify("A revision is already in progress for this session.", "warning");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const targetUser = findTargetUserEntry(branch, options.upto);
			if (!targetUser) {
				ctx.ui.notify(`No user turn found for --upto ${options.upto}.`, "error");
				return;
			}

			const replacedEntries = collectReplacedEntries(branch, targetUser.id);
			if (replacedEntries.length === 0) {
				ctx.ui.notify("No assistant content found after the selected user turn.", "error");
				return;
			}

			const originalText = buildEntriesText(replacedEntries);
			const maxChars = parseMaxChars(pi.getFlag("revision-max-recap-chars"));
			const requestId = crypto.randomUUID();
			state.status = "generating";
			state.generatedMessages = [];
			state.request = {
				requestId,
				mode: options.mode,
				prompt: options.prompt,
				targetUser,
				replacedEntries,
				boundedOriginalText: buildBoundedOriginalText(originalText, maxChars),
				originalTextLength: originalText.length,
				leafBefore: ctx.sessionManager.getLeafId(),
			};

			pi.sendUserMessage(createReviseInstruction(options.upto, options.prompt));
			ctx.ui.notify("Revision generation started. The branch will be replaced after the response completes.", "info");
		},
	});
}
