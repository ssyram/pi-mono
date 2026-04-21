/**
 * Ultrawork message routing — selects model-appropriate ultrawork message.
 *
 * Routing priority:
 * 1. GPT models → gpt-message.ts
 * 2. Gemini models → gemini-message.ts
 * 3. Everything else (Claude, etc.) → default-message.ts
 */

import { ULTRAWORK_DEFAULT_MESSAGE } from "./default-message.js";
import { ULTRAWORK_GEMINI_MESSAGE } from "./gemini-message.js";
import { ULTRAWORK_GPT_MESSAGE } from "./gpt-message.js";

// ─── Model detection ─────────────────────────────────────────────────────────

function extractModelName(modelId: string): string {
	// Strip provider prefix: "openai/gpt-5.4" → "gpt-5.4"
	const slashIndex = modelId.lastIndexOf("/");
	return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

export function isGptModel(modelId: string): boolean {
	return extractModelName(modelId).toLowerCase().includes("gpt");
}

export function isGeminiModel(modelId: string): boolean {
	const id = modelId.toLowerCase();
	return (
		id.startsWith("google/") ||
		id.startsWith("google-vertex/") ||
		extractModelName(id).startsWith("gemini-")
	);
}

// ─── Message routing ─────────────────────────────────────────────────────────

export function getUltraworkMessage(modelId?: string): string {
	if (!modelId) return ULTRAWORK_DEFAULT_MESSAGE;
	if (isGptModel(modelId)) return ULTRAWORK_GPT_MESSAGE;
	if (isGeminiModel(modelId)) return ULTRAWORK_GEMINI_MESSAGE;
	return ULTRAWORK_DEFAULT_MESSAGE;
}
