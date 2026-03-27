/**
 * Shared model resolution with priority-based matching.
 *
 * Priority order:
 *   0 — exact id match
 *   1 — exact name match
 *   2 — substring match (shortest surplus wins; ties broken by lexicographic id desc)
 *   3 — fallback chain (ordered list of alternative model strings)
 *   4 — config default_model (global fallback from oh-my-pi config)
 *   5 — fallback to caller-supplied default
 */

import type { Api, Model } from "@mariozechner/pi-ai";

export interface ResolveModelResult {
	model: Model<Api>;
	warning?: string;
}

/**
 * Try to resolve a model string against available models using exact id,
 * exact name, or substring match. Returns the best match or undefined.
 */
function tryResolveModel(
	modelString: string,
	available: ReadonlyArray<Model<Api>>,
): Model<Api> | undefined {
	// Exact id
	const exactId = available.find((m) => m.id === modelString);
	if (exactId) return exactId;

	// Exact name
	const exactName = available.find((m) => m.name === modelString);
	if (exactName) return exactName;

	// Substring match (best match only)
	const candidates = available
		.filter((m) => m.id.includes(modelString))
		.sort((a, b) => {
			const surplusA = a.id.length - modelString.length;
			const surplusB = b.id.length - modelString.length;
			if (surplusA !== surplusB) return surplusA - surplusB;
			return b.id.localeCompare(a.id);
		});

	return candidates.length > 0 ? candidates[0] : undefined;
}

export function resolveModelFromRegistry(
	modelString: string,
	available: ReadonlyArray<Model<Api>>,
	fallback: Model<Api>,
	fallbackModels?: string[],
	defaultModel?: string,
): ResolveModelResult {
	// Priority 0: exact id match
	const exactId = available.find((m) => m.id === modelString);
	if (exactId) return { model: exactId };

	// Priority 1: exact name match
	const exactName = available.find((m) => m.name === modelString);
	if (exactName) return { model: exactName };

	// Priority 2: substring match with ranking
	const candidates = available
		.filter((m) => m.id.includes(modelString))
		.map((m) => ({
			model: m,
			// "surplus" = id length - modelString length; smaller means closer to exact
			surplus: m.id.length - modelString.length,
		}))
		.sort((a, b) => {
			// 1. Smaller surplus first (closer match)
			if (a.surplus !== b.surplus) return a.surplus - b.surplus;
			// 2. Same surplus: prefer lexicographically larger id (newer date suffix)
			return b.model.id.localeCompare(a.model.id);
		});

	if (candidates.length > 0) {
		const chosen = candidates[0].model;
		const warning =
			candidates.length > 1
				? `Model "${modelString}" matched ${candidates.length} candidates. Selected "${chosen.id}" (closest match). Other candidates: ${candidates
						.slice(1, 4)
						.map((c) => c.model.id)
						.join(", ")}`
				: `Model "${modelString}" resolved to "${chosen.id}" (substring match)`;
		return { model: chosen, warning };
	}

	// Priority 3: try fallback chain models in order
	if (fallbackModels && fallbackModels.length > 0) {
		for (const fbModel of fallbackModels) {
			const result = tryResolveModel(fbModel, available);
			if (result) {
				return {
					model: result,
					warning: `Model "${modelString}" not found. Fell back to "${result.id}" from fallback chain.`,
				};
			}
		}
	}

	// Priority 4: try config default_model
	if (defaultModel) {
		const result = tryResolveModel(defaultModel, available);
		if (result) {
			return {
				model: result,
				warning: `Model "${modelString}" not found. Fell back to config default_model "${result.id}".`,
			};
		}
	}

	// Priority 5: fallback to parent model
	return {
		model: fallback,
		warning: `Model "${modelString}" not found in available models. Falling back to "${fallback.id}".`,
	};
}
