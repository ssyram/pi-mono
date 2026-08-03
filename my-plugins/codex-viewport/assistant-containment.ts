interface AssistantMessageLike {
	role: string;
	content?: unknown;
}

function shouldContainAssistant(message: AssistantMessageLike): boolean {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return false;
	return message.content.some((block) => {
		if (typeof block !== "object" || block === null) return true;
		const type = (block as Record<string, unknown>).type;
		return type !== "text" && type !== "toolCall";
	});
}

export { shouldContainAssistant };
export type { AssistantMessageLike };
