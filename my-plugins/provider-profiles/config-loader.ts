/**
 * File layer for ~/.pi/agent/provider-profiles.json. Whole-file failures only
 * (missing file counts as empty config); per-entry errors belong to
 * config-entry.ts. See docs/detailed.md (C1).
 */

import { readFile } from "node:fs/promises";

export type RawProfileConfig = Readonly<Record<string, unknown>>;

export class ConfigError extends Error {
	readonly path: string;

	constructor(path: string, reason: string) {
		super(`provider-profiles config error (${path}): ${reason}`);
		this.path = path;
	}
}

export async function readProfileConfig(path: string): Promise<RawProfileConfig> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new ConfigError(path, `unreadable: ${error instanceof Error ? error.message : String(error)}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new ConfigError(path, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ConfigError(
			path,
			"top level must be a JSON object mapping profile names to entries",
		);
	}
	return parsed as RawProfileConfig;
}

/** Provider ids already claimed by the user's models.json (G-02 denylist
 * source). Read-only and best-effort: missing file or parse failure yields an
 * empty set (with a warning on parse failure); pi itself owns models.json
 * validation. */
export async function readModelsJsonProviderIds(path: string): Promise<ReadonlySet<string>> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch {
		return new Set();
	}
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null) return new Set();
		const providers = (parsed as { providers?: unknown }).providers;
		if (typeof providers !== "object" || providers === null) return new Set();
		return new Set(Object.keys(providers));
	} catch {
		console.warn(
			`[provider-profiles] could not parse ${path} for name-collision checks; models.json id collisions will not be detected`,
		);
		return new Set();
	}
}
