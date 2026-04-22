/**
 * Message-inspection helpers for the Stop hook.
 * Adapted from oh-my-pi-v2/hooks/boulder-helpers.ts.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";

export function findLastAssistant(
	messages: readonly { role: string; content?: unknown }[],
): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as AssistantMessage;
		if (m.role === "assistant") return m;
	}
	return undefined;
}

export function wasAborted(
	messages: readonly { role: string; content?: unknown }[],
): boolean {
	const last = findLastAssistant(messages);
	if (!last) return false;
	return last.stopReason === "aborted";
}

/** Heuristic: last assistant message ends with a question. */
export function isAskingQuestion(
	messages: readonly { role: string; content?: unknown }[],
): boolean {
	const last = findLastAssistant(messages);
	if (!last) return false;

	const text = last.content
		.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
		.map((c) => c.text)
		.join("");
	if (text.trim().endsWith("?")) return true;

	return last.content.some(
		(c) => c.type === "toolCall" && c.name === "question",
	);
}
