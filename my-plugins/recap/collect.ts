/**
 * Collect full visible conversation history for recap summarization.
 *
 * Uses the same approach as the impression plugin: buildSessionContext +
 * JSON.stringify — no truncation, so the recap model sees everything.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildSessionContext } from "@mariozechner/pi-coding-agent";

export interface CollectedContext {
	/** Full serialized conversation for the LLM. */
	text: string;
	/** Number of message entries in the visible history. */
	messageCount: number;
}

/**
 * Serialize the visible message history the same way the impression plugin
 * does: JSON.stringify each message and join with newlines.
 */
function serializeMessages(
	messages: ReturnType<typeof buildSessionContext>["messages"],
): string {
	return messages.map((m) => JSON.stringify(m)).join("\n");
}

/**
 * Build the full visible conversation text from session entries.
 */
export function collectMessages(
	sessionManager: ExtensionContext["sessionManager"],
): CollectedContext {
	const ctx = buildSessionContext(sessionManager.getEntries());
	const text = serializeMessages(ctx.messages);
	return { text, messageCount: ctx.messages.length };
}
