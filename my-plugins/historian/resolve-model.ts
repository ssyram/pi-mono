/**
 * Resolve a model ID string to a Model object from the registry.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { log } from "./logger.js";

/**
 * Resolve a model by ID string from available models.
 * Tries exact match on model.id, then substring match.
 * Returns undefined if not found.
 */
export function resolveModel(
	modelId: string,
	ctx: ExtensionContext,
): ReturnType<typeof ctx.modelRegistry.getAvailable>[number] | undefined {
	const available = ctx.modelRegistry.getAvailable();

	// Exact match on model.id
	const exact = available.find((m) => m.id === modelId);
	if (exact) return exact;

	// Substring match (e.g. "haiku" matches "claude-haiku-4-5-20251001")
	const substring = available.filter((m) => m.id.includes(modelId) || m.name.toLowerCase().includes(modelId.toLowerCase()));
	if (substring.length === 1) return substring[0];
	if (substring.length > 1) {
		log.warn(`resolveModel: "${modelId}" matched ${substring.length} models, using first: ${substring[0].id}`);
		return substring[0];
	}

	log.warn(`resolveModel: "${modelId}" not found in ${available.length} available models`);
	return undefined;
}
