/**
 * Configuration management for oh-my-pi v2.
 *
 * Categories are advisory data for Sisyphus's prompt — they tell it which
 * agent to call via subagent() and which model to prefer. No programmatic
 * routing; the LLM makes the decision based on prompt guidance.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CategoryConfig {
	model: string;
	agent: string;
	description: string;
	fallbackModels?: string[];
}

export interface OhMyPiConfig {
	categories?: Record<string, Partial<CategoryConfig>>;
	disabled_agents?: string[];
	default_model?: string;
	boulder_enabled?: boolean;
	sisyphus_rules_enabled?: boolean;
}

export const DEFAULT_CATEGORIES: Record<string, CategoryConfig> = {
	"visual-engineering": {
		model: "claude-sonnet-4-6",
		agent: "sisyphus-junior",
		description: "Frontend/UI, CSS, styling, layout, animation, design, components",
		fallbackModels: ["gpt-5.3-codex", "gemini-2.5-pro"],
	},
	ultrabrain: {
		model: "claude-opus-4",
		agent: "sisyphus-junior",
		description: "Hard logic, architecture decisions, algorithms, complex reasoning",
		fallbackModels: ["gpt-5.4", "gemini-2.5-pro"],
	},
	deep: {
		model: "claude-sonnet-4-6",
		agent: "hephaestus",
		description: "Autonomous research + end-to-end implementation (long-running)",
		fallbackModels: ["gpt-5.4", "gemini-2.5-pro"],
	},
	artistry: {
		model: "claude-sonnet-4-6",
		agent: "sisyphus-junior",
		description: "Highly creative / artistic tasks, bold aesthetic choices",
		fallbackModels: ["gpt-5.4", "gemini-2.5-pro"],
	},
	quick: {
		model: "claude-haiku-4-5",
		agent: "sisyphus-junior",
		description: "Single-file typo, trivial config change, small fixes",
		fallbackModels: ["gpt-5.3-codex", "gemini-2.5-flash"],
	},
	"unspecified-low": {
		model: "claude-sonnet-4-6",
		agent: "sisyphus-junior",
		description: "Moderate effort tasks that don't fit specific categories",
		fallbackModels: ["gpt-5.3-codex", "gemini-2.5-pro"],
	},
	"unspecified-high": {
		model: "claude-opus-4",
		agent: "sisyphus-junior",
		description: "Substantial cross-system effort, no specific category fit",
		fallbackModels: ["gpt-5.4", "gemini-2.5-pro"],
	},
	writing: {
		model: "claude-sonnet-4-6",
		agent: "sisyphus-junior",
		description: "Documentation, READMEs, technical writing, prose",
		fallbackModels: ["gpt-5.4", "gemini-2.5-pro"],
	},
};

// ─── JSONC Utilities ─────────────────────────────────────────────────────────

function stripJsoncComments(text: string): string {
	let result = "";
	const len = text.length;
	let i = 0;

	while (i < len) {
		if (text[i] === '"') {
			result += '"';
			i++;
			while (i < len && text[i] !== '"') {
				if (text[i] === "\\") {
					result += text[i];
					i++;
					if (i < len) {
						result += text[i];
						i++;
					}
					continue;
				}
				result += text[i];
				i++;
			}
			if (i < len) {
				result += '"';
				i++;
			}
			continue;
		}

		// Line comment
		if (text[i] === "/" && i + 1 < len && text[i + 1] === "/") {
			i += 2;
			// Skip until newline. The newline itself is NOT consumed → preserved in output.
			while (i < len && text[i] !== "\n") {
				i++;
			}
			continue;
		}

		// Block comment
		if (text[i] === "/" && i + 1 < len && text[i + 1] === "*") {
			i += 2;
			while (i < len && !(text[i] === "*" && i + 1 < len && text[i + 1] === "/")) {
				i++;
			}
			if (i < len) {
				i += 2;
			}
			continue;
		}

		result += text[i];
		i++;
	}
	return result;
}

function removeTrailingCommas(text: string): string {
	// String-aware trailing comma removal. Walks character by character,
	// skipping content inside JSON string literals, so ",}" inside a string
	// value is preserved. Only commas followed by whitespace then } or ] in
	// structural positions are removed.
	let result = "";
	const len = text.length;
	let i = 0;

	while (i < len) {
		// Skip string literals verbatim
		if (text[i] === '"') {
			result += '"';
			i++;
			while (i < len && text[i] !== '"') {
				if (text[i] === "\\") {
					result += text[i];
					i++;
					if (i < len) { result += text[i]; i++; }
					continue;
				}
				result += text[i];
				i++;
			}
			if (i < len) { result += '"'; i++; }
			continue;
		}

		// Check for trailing comma: , followed by optional whitespace then } or ]
		if (text[i] === ",") {
			let j = i + 1;
			while (j < len && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) j++;
			if (j < len && (text[j] === "}" || text[j] === "]")) {
				// Skip the comma (trailing comma removed)
				i++;
				continue;
			}
		}

		result += text[i];
		i++;
	}
	return result;
}

function parseJsonc<T>(text: string): T {
	const stripped = stripJsoncComments(text);
	const cleaned = removeTrailingCommas(stripped);
	return JSON.parse(cleaned) as T;
}

async function tryLoadJsonc<T>(path: string): Promise<T | null> {
	try {
		const raw = await readFile(path, "utf-8");
		return parseJsonc<T>(raw);
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw err;
	}
}

// ─── Config Loading ──────────────────────────────────────────────────────────

export async function loadConfig(cwd: string): Promise<OhMyPiConfig> {
	const userPath = join(homedir(), ".pi", "oh-my-pi.jsonc");
	const projectPath = join(cwd, ".pi", "oh-my-pi.jsonc");

	const userConfig = (await tryLoadJsonc<OhMyPiConfig>(userPath)) ?? {};
	const projectConfig = (await tryLoadJsonc<OhMyPiConfig>(projectPath)) ?? {};

	// Category merging: per-key shallow merge. Project overrides user per-category.
	const userCats = userConfig.categories ?? {};
	const projectCats = projectConfig.categories ?? {};
	const allCategoryKeys = new Set([...Object.keys(userCats), ...Object.keys(projectCats)]);
	const mergedCategories: Record<string, Partial<CategoryConfig>> = {};
	for (const key of allCategoryKeys) {
		mergedCategories[key] = { ...userCats[key], ...projectCats[key] };
	}

	// Top-level merge: project overrides user for scalar fields.
	return {
		...userConfig,
		...projectConfig,
		categories: mergedCategories,
		disabled_agents: [...new Set([...(userConfig.disabled_agents ?? []), ...(projectConfig.disabled_agents ?? [])])],
	};
}

export function getCategory(config: OhMyPiConfig, name: string): CategoryConfig | undefined {
	const builtin = DEFAULT_CATEGORIES[name];
	const override = config.categories?.[name];

	if (!builtin && !override) return undefined;
	if (!override) return builtin;

	// Merge override on top of builtin defaults.
	return {
		model: override.model ?? builtin?.model ?? "claude-sonnet-4-6",
		agent: override.agent ?? builtin?.agent ?? "sisyphus-junior",
		description: override.description ?? builtin?.description ?? name,
		fallbackModels: override.fallbackModels ?? builtin?.fallbackModels,
	};
}
