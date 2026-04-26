import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { parseReviseArgs } from "./parse-revise-args.js";
import { createRevisionRenderer } from "./revision-renderer.js";
import { REVISION_TYPE, createRequestId } from "./revision-state.js";
import { findTargetUserEntry, handleCompletedRevision } from "./revision-completion.js";
import { clearRevisionSessionState, getRevisionSessionState } from "./revision-session-state.js";
import type { RevisionSessionState } from "./revision-session-state.js";

export default function (pi: ExtensionAPI) {
	const revisionStates: Map<string, RevisionSessionState> = new Map();

	pi.registerMessageRenderer(REVISION_TYPE, createRevisionRenderer());

	pi.on("session_start", async (_event, ctx) => {
		clearRevisionSessionState(revisionStates, ctx.sessionManager.getSessionId());
	});

	pi.on("agent_end", async (_event, ctx) => {
		await handleCompletedRevision({
			ctx,
			sessionStates: revisionStates,
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

			// Collect original text length for metadata
			let originalTextLength = 0;
			const targetIdx = branch.findIndex((e) => e.id === targetUser.id);
			if (targetIdx >= 0) {
				const afterTarget = branch.slice(targetIdx + 1);
				for (const entry of afterTarget) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						const content = (entry.message as { content: unknown }).content;
						originalTextLength += typeof content === "string" ? content.length : JSON.stringify(content).length;
					}
				}
			}

			const requestId = createRequestId();
			state.status = "generating";
			state.request = {
				requestId,
				mode: options.mode,
				prompt: options.prompt,
				targetUserId: targetUser.id,
				leafBefore: ctx.sessionManager.getLeafId(),
				originalTextLength,
			};

			// Send only the user's prompt, not a synthetic instruction
			pi.sendUserMessage(options.prompt);
			ctx.ui.notify("Revision generation started.", "info");
		},
	});
}