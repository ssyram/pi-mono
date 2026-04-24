import type { RevisionDetails, RevisionLiveState, RevisionMode } from "./types.js";

const REVISION_TYPE = "revision-box";
const REVISION_RECAP_MODEL = "openai/gpt-5.4-nano";
const REVISION_STUB =
	"This turn revises an earlier answer. The original assistant content was used as source and omitted from the active branch.";
const NO_RECAP_CONTENT = "Revision selected without generated recap.";

function createRequestId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRevisionDetails(params: {
	requestId: string;
	mode: RevisionMode;
	status: RevisionDetails["status"];
	targetUserId: string;
	oldLeafId: string | null;
	replacedEntryIds: string[];
	revisePrompt: string;
	originalTextLength: number;
	recap?: string;
	error?: string;
}): RevisionDetails {
	return {
		requestId: params.requestId,
		mode: params.mode,
		status: params.status,
		targetUserId: params.targetUserId,
		oldLeafId: params.oldLeafId,
		replacedEntryIds: params.replacedEntryIds,
		revisePrompt: params.revisePrompt,
		originalTextLength: params.originalTextLength,
		recap: params.recap,
		error: params.error,
		createdAt: new Date().toISOString(),
	};
}

function createRevisionContent(mode: RevisionMode, recap: string | null): string {
	if (mode === "visible-summary") return recap ?? NO_RECAP_CONTENT;
	if (mode === "no-summary") return NO_RECAP_CONTENT;
	return REVISION_STUB;
}

function updateLiveState(
	liveStates: Map<string, RevisionLiveState>,
	requestId: string,
	patch: Partial<RevisionLiveState>,
): void {
	const current = liveStates.get(requestId);
	if (!current) return;
	liveStates.set(requestId, { ...current, ...patch });
}

export {
	createRequestId,
	createRevisionContent,
	createRevisionDetails,
	NO_RECAP_CONTENT,
	REVISION_RECAP_MODEL,
	REVISION_STUB,
	REVISION_TYPE,
	updateLiveState,
};
