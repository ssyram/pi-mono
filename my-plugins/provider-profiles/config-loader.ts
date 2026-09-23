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

/** A same-name models.json entry is safe when it only overrides model
 * metadata. Provider-level fields and model headers can change authentication
 * or request routing, so only those names conflict with a profile instance.
 * Parse JSON comments/trailing commas just as Pi's ModelConfig.load does. */
export async function readModelsJsonConflicts(path: string): Promise<ReadonlySet<string>> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch {
		return new Set();
	}
	try {
		const withoutComments = text.replace(/^\uFEFF/, "").replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) =>
			match[0] === '"' ? match : "",
		);
		const normalized = withoutComments.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail: string | undefined) =>
			tail ?? (match[0] === '"' ? match : ""),
		);
		const parsed: unknown = JSON.parse(normalized);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Set();
		const providers = (parsed as { providers?: unknown }).providers;
		if (typeof providers !== "object" || providers === null || Array.isArray(providers)) return new Set();
		const conflicts = new Set<string>();
		for (const [name, value] of Object.entries(providers)) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
			const config = value as Record<string, unknown>;
			if (Object.keys(config).some((key) => key !== "modelOverrides")) {
				conflicts.add(name);
				continue;
			}
			const overrides = config.modelOverrides;
			if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) continue;
			for (const override of Object.values(overrides)) {
				if (typeof override === "object" && override !== null && "headers" in override) {
					conflicts.add(name);
					break;
				}
			}
		}
		return conflicts;
	} catch {
		console.warn(`[provider-profiles] could not parse ${path} for unsafe overlay checks`);
		return new Set();
	}
}
