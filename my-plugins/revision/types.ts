export interface ReviseOptions {
	upto: number;
	mode: RevisionMode;
	prompt: string;
}

export type RevisionMode = "default" | "visible-summary" | "no-summary";

export interface RevisionDetails {
	requestId: string;
	mode: RevisionMode;
	targetUserId: string;
	oldLeafId: string | null;
	replacedEntryIds: string[];
	revisePrompt: string;
	originalTextLength: number;
	recap?: string;
	createdAt: string;
}