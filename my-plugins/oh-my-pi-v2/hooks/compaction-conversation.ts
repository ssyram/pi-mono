import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { filterBoulderResumeMessages } from "./boulder-resume-message.js";
import {
	formatCompactionTaskContext,
	type CompactionTaskStateReader,
} from "./compaction-task-context.js";

export interface CompactionContext {
	conversationText: string;
	taskContext: string;
}

export type CompactionConversationSerializer = (messages: AgentMessage[]) => string;

export function buildCompactionContext(
	messages: AgentMessage[],
	getTaskState: CompactionTaskStateReader,
	context: ExtensionContext,
	serialize: CompactionConversationSerializer,
): CompactionContext {
	const messagesWithoutResumes = filterBoulderResumeMessages(messages, undefined);
	return {
		conversationText: serialize(messagesWithoutResumes),
		taskContext: formatCompactionTaskContext(getTaskState, context),
	};
}
