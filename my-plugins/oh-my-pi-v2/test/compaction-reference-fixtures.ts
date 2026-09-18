import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

export function user(content: UserMessage["content"]): UserMessage {
	return { role: "user", content, timestamp: 0 };
}

export function assistant(
	content: AssistantMessage["content"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

export function tool(text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: "call",
		toolName: "read",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: 0,
	};
}
