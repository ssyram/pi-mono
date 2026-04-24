import type { AgentMessage } from "@mariozechner/pi-agent-core";

export interface WritableSessionManagerLike {
	appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: string,
		display: boolean,
		details?: T,
	): string;
	appendMessage(message: AgentMessage): string;
	branch(branchFromId: string): void;
	resetLeaf(): void;
}

export function asWritableSessionManager(sessionManager: unknown): WritableSessionManagerLike {
	return sessionManager as WritableSessionManagerLike;
}
