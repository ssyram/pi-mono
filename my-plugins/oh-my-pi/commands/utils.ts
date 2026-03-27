/**
 * Shared utility functions for oh-my-pi commands.
 */

/**
 * Extract the text content from the last assistant message in a message array.
 * Walks backward through the messages to find the most recent assistant turn,
 * then concatenates all text content blocks.
 */
export function extractLastAssistantText(messages: ReadonlyArray<{ role: string; content?: unknown }>): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const content = msg.content;
		if (!Array.isArray(content)) continue;
		return (content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text!)
			.join("\n");
	}
	return "";
}
