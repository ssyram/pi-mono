import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { formatTruncationNotice } from "../bounded-llm-input.js";
import { generateBoundedRecap } from "./revision-lifecycle.js";
import { createRevisionContent, createRevisionDetails, REVISION_RECAP_MODEL, REVISION_TYPE } from "./revision-state.js";
import { clearRevisionSessionState, getRevisionSessionState } from "./revision-session-state.js";
import { asWritableSessionManager } from "./session-write.js";
import type { RevisionMode } from "./types.js";

function isCompleteAssistantMessage(message: AgentMessage): boolean {
	return message.role === "assistant" && message.stopReason !== "aborted";
}

function createReviseInstruction(upto: number, prompt: string): string {
	return `Revise the above ${upto} assistant response(s) with these instructions: ${prompt}`;
}

function fallbackVisibleRecap(mode: RevisionMode, originalText: string, maxChars: number): string | null {
	if (mode !== "visible-summary") return null;
	const firstLine = originalText.trim().split(/\r?\n/).find((line) => line.trim());
	const source = firstLine ?? "Original answer selected for revision.";
	return source.length > maxChars ? `${formatTruncationNotice(source.length, maxChars)}\n${source.slice(0, maxChars)}` : source;
}

function restoreLeaf(ctx: ExtensionContext, oldLeafId: string | null): void {
	const sm = asWritableSessionManager(ctx.sessionManager);
	if (oldLeafId) sm.branch(oldLeafId);
	else sm.resetLeaf();
}

async function maybeGenerateRecap(params: {
	ctx: ExtensionContext;
	mode: RevisionMode;
	originalText: string;
	maxChars: number;
}): Promise<string | null> {
	if (params.mode === "no-summary") return null;
	try {
		return await generateBoundedRecap({
			originalText: params.originalText,
			getSystemPrompt: () => params.ctx.getSystemPrompt(),
			recapModel: REVISION_RECAP_MODEL,
			modelRegistry: params.ctx.modelRegistry,
			maxChars: params.maxChars,
		});
	} catch (error) {
		params.ctx.ui.notify(`Revision recap unavailable: ${error instanceof Error ? error.message : String(error)}`, "warning");
		return null;
	}
}

async function handleCompletedRevision(params: { ctx: ExtensionContext; sessionStates: Parameters<typeof getRevisionSessionState>[0]; maxChars: number }): Promise<void> {
	const sessionId = params.ctx.sessionManager.getSessionId();
	const state = getRevisionSessionState(params.sessionStates, sessionId);
	const request = state.request;
	if (state.status !== "generating" || !request) return;

	const generatedMessages = state.generatedMessages.filter(isCompleteAssistantMessage);
	if (generatedMessages.length === 0) {
		clearRevisionSessionState(params.sessionStates, sessionId);
		params.ctx.ui.notify("Revision was interrupted before a replacement response completed; original branch left unchanged.", "info");
		return;
	}

	const generatedRecap = await maybeGenerateRecap({
		ctx: params.ctx,
		mode: request.mode,
		originalText: request.boundedOriginalText,
		maxChars: params.maxChars,
	});
	const recap = generatedRecap ?? fallbackVisibleRecap(request.mode, request.boundedOriginalText, params.maxChars);
	const sm = asWritableSessionManager(params.ctx.sessionManager);

	try {
		if (request.targetUser.parentId) sm.branch(request.targetUser.parentId);
		else sm.resetLeaf();

		sm.appendMessage(request.targetUser.message);
		sm.appendCustomMessageEntry(
			REVISION_TYPE,
			createRevisionContent(request.mode, recap),
			true,
			createRevisionDetails({
				requestId: request.requestId,
				mode: request.mode,
				status: "done",
				targetUserId: request.targetUser.id,
				oldLeafId: request.leafBefore,
				replacedEntryIds: request.replacedEntries.map((entry) => entry.id),
				revisePrompt: request.prompt,
				originalTextLength: request.originalTextLength,
				recap: recap ?? undefined,
			}),
		);
		for (const message of generatedMessages) sm.appendMessage(message);
		params.ctx.ui.notify("Revision complete. Previous answer is preserved on the old branch.", "info");
	} catch (error) {
		restoreLeaf(params.ctx, request.leafBefore);
		params.ctx.ui.notify(`Revision failed before branch replacement completed: ${error instanceof Error ? error.message : String(error)}`, "error");
	} finally {
		clearRevisionSessionState(params.sessionStates, sessionId);
	}
}

export { createReviseInstruction, handleCompletedRevision, isCompleteAssistantMessage };
