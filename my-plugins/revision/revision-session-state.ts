import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { RevisionMode } from "./types.js";

type RevisionStatus = "idle" | "generating";

interface RevisionRequest {
	requestId: string;
	mode: RevisionMode;
	prompt: string;
	targetUser: Extract<SessionEntry, { type: "message" }>;
	replacedEntries: SessionEntry[];
	boundedOriginalText: string;
	originalTextLength: number;
	leafBefore: string | null;
}

interface RevisionSessionState {
	status: RevisionStatus;
	request?: RevisionRequest;
	generatedMessages: AgentMessage[];
}

function getRevisionSessionState(states: Map<string, RevisionSessionState>, sessionId: string): RevisionSessionState {
	let state = states.get(sessionId);
	if (!state) {
		state = { status: "idle", generatedMessages: [] };
		states.set(sessionId, state);
	}
	return state;
}

function clearRevisionSessionState(states: Map<string, RevisionSessionState>, sessionId: string): void {
	states.delete(sessionId);
}

export { clearRevisionSessionState, getRevisionSessionState };
export type { RevisionRequest, RevisionSessionState };
