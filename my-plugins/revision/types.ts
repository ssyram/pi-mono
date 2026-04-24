export interface ReviseOptions {
	upto: number;
	mode: RevisionMode;
	prompt: string;
}

export type RevisionMode = "hidden-summary" | "visible-summary" | "no-summary";

export interface RevisionDetails {
	requestId: string;
	mode: RevisionMode;
	status: "running" | "done" | "error";
	targetUserId: string;
	oldLeafId: string | null;
	replacedEntryIds: string[];
	revisePrompt: string;
	originalTextLength: number;
	recap?: string;
	error?: string;
	createdAt: string;
}

export interface RevisionLiveState {
	requestId: string;
	mode: RevisionMode;
	status: "running" | "done" | "error";
	recap: string;
	error?: string;
}
