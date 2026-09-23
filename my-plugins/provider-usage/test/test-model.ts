import type { UsageModel } from "../src/usage-contract.js";

export function makeModel(options: {
	id?: string;
	provider?: string;
	api?: UsageModel["api"];
	baseUrl?: string;
	reasoning?: boolean;
} = {}): UsageModel {
	return {
		id: options.id ?? "test-model",
		name: "Test model",
		provider: options.provider ?? "named-provider",
		api: options.api ?? "openai-completions",
		baseUrl: options.baseUrl ?? "https://example.invalid/v1",
		reasoning: options.reasoning ?? false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_000,
	};
}
