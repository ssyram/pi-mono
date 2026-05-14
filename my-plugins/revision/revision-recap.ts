import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";
import { REVISION_RECAP_MODEL } from "./revision-state.js";

const SYSTEM_PROMPT = `You are summarizing what changed between an original assistant response and its revised version.
Write a brief, factual recap (1-3 sentences, under 200 characters) in the same language as the content.
Describe what the original said and how the revision differs.
Use plain text, no markdown, no bullet points.`;

/**
 * Find a model by name in the registry.
 * Exact id match first, then shortest substring match from available models.
 */
function findModel(modelName: string, registry: ModelRegistry) {
	const available = registry.getAvailable();
	const exact = available.find((m) => m.id === modelName);
	if (exact) return exact;
	return available.find((m) => m.id.includes(modelName));
}

/**
 * Generate a recap comparing original content with revised content.
 * Returns the recap text, or null on failure.
 */
export async function generateRevisionRecap(
	originalText: string,
	revisedText: string,
	modelName: string,
	registry: ModelRegistry,
	signal?: AbortSignal,
): Promise<string | null> {
	const model = findModel(modelName, registry);
	if (!model) return null;

	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok) return null;

	const userParts = `[Original content]\n${originalText}\n\n[Revised content]\n${revisedText}`;

	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt: SYSTEM_PROMPT,
				messages: [
					{ role: "user" as const, content: userParts, timestamp: Date.now() },
				],
			},
			{
				maxTokens: 200,
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal,
			},
		);

		if (response.stopReason === "aborted") return null;

		let text = "";
		for (const block of response.content) {
			if (block.type === "text") text += block.text;
		}
		return text.trim() || null;
	} catch (error) {
		if (signal?.aborted) return null;
		return null;
	}
}