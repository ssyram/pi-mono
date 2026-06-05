/**
 * Config — reads historian configuration from .pi/config/historian.json
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";

export interface HistorianConfig {
	/** Model ID for intent extraction (e.g. "claude-haiku-4-5"). Falls back to session model. */
	intentModel?: string;
	/** Model ID for semantic compliance checks (e.g. "claude-sonnet-4-6"). Falls back to session model. */
	checkModel?: string;
	/** Model ID for fast gate check (e.g. "claude-haiku-4-5"). Falls back to session model. */
	guardModel?: string;
}

let config: HistorianConfig = {};

/**
 * Load config from {cwd}/.pi/config/historian.json.
 * Silent on missing file or parse errors — defaults to empty config.
 */
export function loadConfig(cwd: string): HistorianConfig {
	const configPath = join(cwd, ".pi", "config", "historian.json");
	try {
		const raw = readFileSync(configPath, "utf-8");
		// Strip comments (JSONC support — simple line-comment stripping)
		const cleaned = raw.replace(/^\s*\/\/.*$/gm, "").trim();
		const parsed = JSON.parse(cleaned);
		config = {
			intentModel: typeof parsed.intentModel === "string" ? parsed.intentModel : undefined,
			checkModel: typeof parsed.checkModel === "string" ? parsed.checkModel : undefined,
			guardModel: typeof parsed.guardModel === "string" ? parsed.guardModel : undefined,
		};
		log.info(`CONFIG | loaded from ${configPath}: intentModel=${config.intentModel ?? "(default)"}, checkModel=${config.checkModel ?? "(default)"}, guardModel=${config.guardModel ?? "(default)"}`);
	} catch {
		// Missing file or parse error — use defaults (session model)
		config = {};
	}
	return config;
}

export function getConfig(): HistorianConfig {
	return config;
}
