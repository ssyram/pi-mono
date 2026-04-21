/**
 * Shared utility functions for oh-my-pi v2 commands.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Extract the text content from the last assistant message in a message array.
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

/**
 * Read an agent's system prompt from its .md file.
 * Returns the body text after the frontmatter separator.
 */
export async function readAgentPrompt(agentsDir: string, agentName: string): Promise<string | undefined> {
	try {
		const content = await readFile(join(agentsDir, `${agentName}.md`), "utf-8");
		const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
		return match ? match[1].trim() : content.trim();
	} catch {
		return undefined;
	}
}
