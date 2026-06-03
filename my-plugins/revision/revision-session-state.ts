import type { RevisionMode } from "./types.js";

type RevisionStatus = "idle" | "generating";

interface RevisionRequest {
	requestId: string;
	mode: RevisionMode;
	prompt: string;
	targetUserId: string;
	leafBefore: string | null;
	originalTextLength: number;
}

interface RevisionSessionState {
	status: RevisionStatus;
	request?: RevisionRequest;
}

function getRevisionSessionState(states: Map<string, RevisionSessionState>, sessionId: string): RevisionSessionState {
	let state = states.get(sessionId);
	if (!state) {
		state = { status: "idle" };
		states.set(sessionId, state);
	}
	return state;
}

function clearRevisionSessionState(states: Map<string, RevisionSessionState>, sessionId: string): void {
	states.delete(sessionId);
}

export { clearRevisionSessionState, getRevisionSessionState };
export type { RevisionRequest, RevisionSessionState };