import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import type { ExtensionContext, SessionEntry, SessionMessageEntry } from "@mariozechner/pi-coding-agent";
import type { RevisionSessionState } from "./revision-session-state.js";
import { clearRevisionSessionState } from "./revision-session-state.js";
import {
	REVISION_TYPE,
	createOmittedContent,
	createRevisionDetails,
} from "./revision-state.js";
import { generateRevisionRecap } from "./revision-recap.js";

const REVISION_WIDGET_KEY = "revision-recap";
const REVISION_WIDGET_DISPLAY_SECONDS = 6;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;



// ---------------------------------------------------------------------------
// Entry helpers
// ---------------------------------------------------------------------------

/** Extract text content from a message content field. */
function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join(" ");
	}
	return "";
}

/** Check if an agent message is a complete assistant response (not aborted). */
function isCompleteAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
	return msg.role === "assistant" && msg.stopReason !== "aborted";
}

/** Build text representation of session entries for recap source material. */
function buildEntriesText(entries: SessionEntry[]): string {
	const parts: string[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			const msg = entry.message;
			const content = (msg as { content: unknown }).content;
			if (msg.role === "assistant") {
				parts.push(`ASSISTANT: ${extractTextContent(content)}`);
			} else if (msg.role === "user") {
				parts.push(`ME: ${extractTextContent(content)}`);
			}
		} else if (entry.type === "branch_summary") {
			parts.push(`[Branch summary: ${entry.summary}]`);
		} else if (entry.type === "compaction") {
			parts.push(`[Compaction: ${entry.summary}]`);
		}
	}
	return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Find target user entry
// ---------------------------------------------------------------------------

/** Find the Nth-from-last user message entry in a branch (upto=1 = most recent). */
export function findTargetUserEntry(branch: SessionEntry[], upto: number): SessionMessageEntry | undefined {
	let count = 0;
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "message" && entry.message.role === "user") {
			count++;
			if (count === upto) return entry;
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Entry discovery: partition the tree path into B / C / D segments
// ---------------------------------------------------------------------------

interface DiscoveredEntries {
	/** Original content between A (exclusive) and leafBefore (inclusive) — the B segment */
	originalEntries: SessionEntry[];
	/** Replaced entry IDs (B segment IDs) */
	replacedEntryIds: string[];
	/** Generated assistant messages from D */
	generatedMessages: AssistantMessage[];
	/** Text of original (B) content for recap */
	originalText: string;
	/** Text of revised (D) content for recap */
	revisedText: string;
}

/**
 * Walk the current branch and partition entries relative to the revision markers.
 *
 * Tree layout at agent_end time:
 *   ... → A (targetUserId) → B entries... → [leafBefore] → C (revise user msg) → D entries... → leaf
 *
 * We walk from leaf back to targetUserId, separating B / C / D.
 */
function discoverEntries(
	branch: SessionEntry[],
	targetUserId: string,
	leafBefore: string | null,
): DiscoveredEntries {
	const empty: DiscoveredEntries = {
		originalEntries: [],
		replacedEntryIds: [],
		generatedMessages: [],
		originalText: "",
		revisedText: "",
	};

	// Build id → entry index
	const byId = new Map<string, number>();
	for (let i = 0; i < branch.length; i++) byId.set(branch[i].id, i);

	// Find indices
	const targetIdx = byId.get(targetUserId);
	if (targetIdx === undefined) return empty;

	// leafBefore must be present to partition B/C/D segments
	const leafBeforeIdx = leafBefore ? byId.get(leafBefore) : undefined;
	if (leafBeforeIdx === undefined || leafBeforeIdx < 0) {
		// Without a valid leaf boundary, partitioning is impossible — return empty.
		// This should not happen in practice (leafBefore is set from getLeafId()
		// when /revise runs on a session with prior content).
		return empty;
	}

	const originalEntries = branch.slice(targetIdx + 1, leafBeforeIdx + 1);
	const afterLeafBefore = branch.slice(leafBeforeIdx + 1);

	// C = first user message in afterLeafBefore; D = everything after C
	let dStartIdx = 0;
	for (let i = 0; i < afterLeafBefore.length; i++) {
		const entry = afterLeafBefore[i];
		if (entry.type === "message" && entry.message.role === "user") {
			dStartIdx = i + 1;
			break;
		}
	}

	// Collect generated assistant messages from D
	const generatedPathEntries = afterLeafBefore.slice(dStartIdx);
	const generatedMessages = generatedPathEntries
		.filter((e): e is SessionMessageEntry => e.type === "message" && e.message.role === "assistant")
		.map((e) => e.message)
		.filter(isCompleteAssistantMessage);

	const replacedEntryIds = originalEntries.map((e) => e.id);
	const originalText = buildEntriesText(originalEntries);
	const revisedText = generatedPathEntries
		.filter((e): e is SessionMessageEntry => e.type === "message")
		.map((e) => extractTextContent((e.message as { content: unknown }).content))
		.join("\n");

	return { originalEntries, replacedEntryIds, generatedMessages, originalText, revisedText };
}

// ---------------------------------------------------------------------------
// Writable session manager access
// ---------------------------------------------------------------------------

interface WritableSessionManagerLike {
	appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: string,
		display: boolean,
		details?: T,
	): string;
	appendMessage(message: Message): string;
	branch(branchFromId: string): void;
}

function asWritableSessionManager(sessionManager: unknown): WritableSessionManagerLike {
	return sessionManager as WritableSessionManagerLike;
}

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

function restoreLeaf(ctx: ExtensionContext, oldLeafId: string | null): void {
	const sm = asWritableSessionManager(ctx.sessionManager);
	if (oldLeafId) sm.branch(oldLeafId);
}

// ---------------------------------------------------------------------------
// Fallback recap
// ---------------------------------------------------------------------------

function fallbackRecap(originalText: string): string {
	const firstLine = originalText.trim().split(/\r?\n/).find((line) => line.trim());
	return firstLine ?? "Original answer selected for revision.";
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

interface HandleCompletedRevisionParams {
	ctx: ExtensionContext;
	sessionStates: Map<string, RevisionSessionState>;
}

export async function handleCompletedRevision(params: HandleCompletedRevisionParams): Promise<void> {
	const { ctx } = params;
	const sessionId = ctx.sessionManager.getSessionId();
	const state = params.sessionStates.get(sessionId);
	if (!state || state.status !== "generating" || !state.request) return;

	const request = state.request;

	try {
		// Step 1: Discover entries from tree
		const branch = ctx.sessionManager.getBranch();
		const discovered = discoverEntries(branch, request.targetUserId, request.leafBefore);

		if (discovered.generatedMessages.length === 0) {
			ctx.ui.notify("No assistant response was generated. The original branch is unchanged.", "info");
			return;
		}

		// Step 2: Generate recap (if mode != "no-summary")
		let recap: string | null = null;
		if (request.mode !== "no-summary") {
			recap = await generateRevisionRecap(
				discovered.originalText,
				discovered.revisedText,
				"openai/gpt-4.1-nano",
				ctx.modelRegistry,
				ctx.signal,
			);
			if (!recap) {
				recap = fallbackRecap(discovered.originalText);
			}
		}

		// Step 3: Branch reconstruction
		const sm = asWritableSessionManager(ctx.sessionManager);

		// Branch from targetUser (A) — new branch is a child of A
		sm.branch(request.targetUserId);

		// Append omitted notice as first child of A in new branch
		const omittedContent = createOmittedContent();
		sm.appendCustomMessageEntry(
			REVISION_TYPE,
			omittedContent,
			true,
			createRevisionDetails({
				requestId: request.requestId,
				mode: request.mode,
				targetUserId: request.targetUserId,
				oldLeafId: request.leafBefore,
				replacedEntryIds: discovered.replacedEntryIds,
				revisePrompt: request.prompt,
				originalTextLength: discovered.originalText.length,
				recap: recap ?? undefined,
			}),
		);

		// Append the user's revision prompt
		sm.appendMessage({ role: "user", content: request.prompt, timestamp: Date.now() });

		// Append generated assistant messages
		for (const message of discovered.generatedMessages) {
			sm.appendMessage(message);
		}

		// For visible-summary mode: append recap as a user message so the LLM sees it
		if (request.mode === "visible-summary" && recap) {
			sm.appendMessage({
				role: "user",
				content: `The above revision replaced an earlier answer. Omitted content summary:\n${recap}`,
				timestamp: Date.now(),
			});
		}

		// Step 4: Display recap via UI (widget pattern from recap plugin)
		if (recap && request.mode !== "no-summary") {
			if (dismissTimer) clearTimeout(dismissTimer);
			ctx.ui.setWidget(REVISION_WIDGET_KEY, [`\u21BB Revision: ${recap}`], {
				placement: "aboveEditor",
			});
			dismissTimer = setTimeout(() => {
				ctx.ui.setWidget(REVISION_WIDGET_KEY, undefined);
				ctx.ui.notify(`Revision recap: ${recap}`, "info");
				dismissTimer = null;
			}, REVISION_WIDGET_DISPLAY_SECONDS * 1000);
		} else {
			ctx.ui.notify("Revision complete. Previous answer is preserved on the old branch.", "info");
		}
	} catch (error) {
		restoreLeaf(ctx, request.leafBefore);
		ctx.ui.notify(
			`Revision failed during branch reconstruction: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	} finally {
		clearRevisionSessionState(params.sessionStates, sessionId);
	}
}