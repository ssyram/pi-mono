import { complete } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

const SYSTEM_PROMPT = [
	"Write a short factual recap of the assistant content that is being replaced.",
	"Focus on what the previous answer said, not what should happen next.",
	"Mention the original answer's main points and any notable wording briefly.",
	"Use the same language as the conversation.",
	"Return plain text only.",
	"Keep it under 220 characters.",
].join(" ");

function findModel(modelName: string, registry: ModelRegistry) {
	const [provider, ...rest] = modelName.split("/");
	const modelId = rest.join("/");
	if (!provider || !modelId) return undefined;
	return registry.find(provider, modelId);
}

export async function generateRevisionRecap(
	originalText: string,
	originalSystemPrompt: string | undefined,
	modelName: string,
	registry: ModelRegistry,
): Promise<string | null> {
	const model = findModel(modelName, registry);
	if (!model) return null;
	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return null;

	const userParts: string[] = [];
	if (originalSystemPrompt) {
		userParts.push(
			"--- Original system prompt given to the assistant ---",
			originalSystemPrompt,
			"--- End of original system prompt ---",
		);
	}
	userParts.push("--- Original assistant content being replaced ---", originalText);

	try {
		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: userParts.join("\n") }],
						timestamp: Date.now(),
					},
				],
			},
			{
				systemPrompt: SYSTEM_PROMPT,
				maxTokens: 220,
				apiKey: auth.apiKey,
				headers: auth.headers,
			},
		);
		const text = response.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		return text || null;
	} catch (error) {
		return `Recap unavailable (${error instanceof Error ? error.message : String(error)})`;
	}
}
