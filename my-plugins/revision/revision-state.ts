import { randomUUID } from "crypto";
import type { RevisionDetails, RevisionMode } from "./types.js";

const REVISION_TYPE = "revision-box";
const REVISION_RECAP_MODEL = "openai/gpt-4.1-nano";
const OMITTED_NOTICE = "This turn revises an earlier answer. The original content was omitted from this branch.";

function createRequestId(): string {
	return randomUUID();
}

function createRevisionDetails(params: {
	requestId: string;
	mode: RevisionMode;
	targetUserId: string;
	oldLeafId: string | null;
	replacedEntryIds: string[];
	revisePrompt: string;
	originalTextLength: number;
	recap?: string;
}): RevisionDetails {
	return {
		requestId: params.requestId,
		mode: params.mode,
		targetUserId: params.targetUserId,
		oldLeafId: params.oldLeafId,
		replacedEntryIds: params.replacedEntryIds,
		revisePrompt: params.revisePrompt,
		originalTextLength: params.originalTextLength,
		recap: params.recap,
		createdAt: new Date().toISOString(),
	};
}

function createOmittedContent(): string {
	return OMITTED_NOTICE;
}

export {
	REVISION_TYPE,
	REVISION_RECAP_MODEL,
	OMITTED_NOTICE,
	createRequestId,
	createRevisionDetails,
	createOmittedContent,
};