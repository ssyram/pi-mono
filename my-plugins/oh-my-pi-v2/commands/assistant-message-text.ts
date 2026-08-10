export function extractLastAssistantText(
	messages: ReadonlyArray<{ role: string; content?: unknown }>,
): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		return (message.content as Array<{ type: string; text?: string }>)
			.filter((content) => content.type === "text" && typeof content.text === "string")
			.map((content) => content.text ?? "")
			.join("\n");
	}
	return "";
}
