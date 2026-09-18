import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	convertToLlm,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { buildCompactionContext } from "../hooks/compaction-conversation.js";
import {
	buildCompactionPrompt,
	buildUpdateCompactionPrompt,
} from "../hooks/compaction-prompt.js";
import type { CompactionTaskStateReader } from "../hooks/compaction-task-context.js";

export const context = { sessionManager: {} } as unknown as ExtensionContext;
export const noTasks: CompactionTaskStateReader = () => ({
	tasks: [],
	actionableCount: 0,
	readyTasks: [],
});

export function compactEvent(
	messages: AgentMessage[],
	previousSummary?: string,
): Pick<SessionBeforeCompactEvent, "preparation" | "customInstructions"> {
	return {
		preparation: {
			messagesToSummarize: messages,
			previousSummary,
			firstKeptEntryId: "kept",
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 100,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { enabled: true, reserveTokens: 1024, keepRecentTokens: 20000 },
		},
	};
}

export function ordinaryPrompt(
	event: ReturnType<typeof compactEvent>,
	readTasks = noTasks,
): string {
	const { conversationText, taskContext } = buildCompactionContext(
		event.preparation.messagesToSummarize,
		readTasks,
		context,
		(messages) => serializeConversation(convertToLlm(messages)),
	);
	return event.preparation.previousSummary
		? buildUpdateCompactionPrompt(
				conversationText,
				event.preparation.previousSummary,
				taskContext,
				event.customInstructions,
			)
		: buildCompactionPrompt(
				conversationText,
				taskContext,
				event.customInstructions,
			);
}
