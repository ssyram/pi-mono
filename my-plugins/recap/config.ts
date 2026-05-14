/**
 * Recap plugin configuration.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RecapConfig {
	/** Timer interval in minutes. 0 = disable timer. */
	intervalMinutes: number;
	/** Model to use for recap (bare name, no provider prefix). */
	model: string;
	/** Trigger recap on agent_end. */
	onAgentEnd: boolean;
	/** Widget display duration in seconds. 0 = no auto-dismiss. */
	displaySeconds: number;
	/** Enable/disable plugin entirely. */
	enabled: boolean;
}

const DEFAULTS: RecapConfig = {
	intervalMinutes: 5,
	model: "gpt-5.4-nano",
	onAgentEnd: true,
	displaySeconds: 30,
	enabled: true,
};

/**
 * Minimal JSONC parser — strips // and /* comments, trailing commas.
 */
function parseJsonc<T>(text: string): T {
	let stripped = text.replace(/\/\/.*$/gm, "");
	stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");
	stripped = stripped.replace(/,\s*([\]}])/g, "$1");
	return JSON.parse(stripped);
}

async function tryLoad(path: string): Promise<Partial<RecapConfig>> {
	try {
		const raw = await readFile(path, "utf-8");
		return parseJsonc<Partial<RecapConfig>>(raw);
	} catch {
		return {};
	}
}

export async function loadRecapConfig(cwd: string): Promise<RecapConfig> {
	const user = await tryLoad(join(homedir(), ".pi", "recap.jsonc"));
	const project = await tryLoad(join(cwd, ".pi", "recap.jsonc"));
	return { ...DEFAULTS, ...user, ...project };
}
