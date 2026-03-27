/**
 * Agent type definitions and model resolution utilities.
 */

export type ModelFamily = "claude" | "gpt" | "gpt-5-4" | "gpt-5-3-codex" | "gemini" | "default";

export interface AgentDef {
	name: string;
	displayName: string;
	description: string;
	systemPrompt: string;
	modelVariants?: Partial<Record<ModelFamily, string>>;
	model: string;
	temperature: number;
	toolPreset: "read-only" | "coding" | "all";
	restrictedTools?: string[];
	fallbackModels?: string[];
	mode: "primary" | "subagent" | "all" | "internal";
	category?: string;
}

export interface ModelLike {
	id: string;
	provider?: string;
	name?: string;
}

/**
 * Detect the model family from a model's provider and id fields.
 * Returns the most specific family match possible.
 */
export function detectModelFamily(model: ModelLike): ModelFamily {
	const provider = model.provider?.toLowerCase() ?? "";
	const id = model.id.toLowerCase();

	// Check for Gemini first (provider or id-based)
	if (provider.includes("google") || provider.includes("gemini") || id.includes("gemini")) {
		return "gemini";
	}

	// Check for OpenAI / GPT variants — order matters: most specific first
	if (
		provider.includes("openai") ||
		id.includes("gpt") ||
		id.includes("codex") ||
		id.includes("o1") ||
		id.includes("o3") ||
		id.includes("o4")
	) {
		if (id.includes("gpt-5") && id.includes("4")) {
			return "gpt-5-4";
		}
		if ((id.includes("gpt-5") && id.includes("3")) || id.includes("codex")) {
			return "gpt-5-3-codex";
		}
		return "gpt";
	}

	// Check for Claude (Anthropic)
	if (
		provider.includes("anthropic") ||
		id.includes("claude") ||
		id.includes("opus") ||
		id.includes("sonnet") ||
		id.includes("haiku")
	) {
		return "claude";
	}

	return "default";
}

/**
 * Resolve the system prompt for an agent given the current model.
 * If the agent defines a modelVariants entry matching the detected family,
 * that variant prompt is returned; otherwise the default systemPrompt is used.
 */
export function resolvePrompt(agent: AgentDef, model: ModelLike): string {
	const family = detectModelFamily(model);

	if (agent.modelVariants) {
		// Try exact family first, then fall back to "default" variant, then systemPrompt
		const variant = agent.modelVariants[family] ?? agent.modelVariants["default"];
		if (variant !== undefined) {
			return variant;
		}
	}

	return agent.systemPrompt;
}
