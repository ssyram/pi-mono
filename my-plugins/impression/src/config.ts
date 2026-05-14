import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { CONFIG_FILE_NAME, DEFAULT_DISTILL_RATE_FLOOR, DEFAULT_MAX_PASSTHROUGH_COUNT, DEFAULT_MAX_RECALL, DEFAULT_MIN_LENGTH } from "./types.js";
import type { ImpressionConfig, ResolvedConfig } from "./types.js";

export function resolveConfig(raw: ImpressionConfig): ResolvedConfig {
	return {
		debugDistillMode: raw["debug:distill-mode"],
		skipDistillation: raw.skipDistillation ?? [],
		minLength: raw.minLength ?? DEFAULT_MIN_LENGTH,
		maxRecall: raw.maxRecallBeforePassthrough ?? DEFAULT_MAX_RECALL,
		maxPassthroughCount: raw.maxPassthroughCount ?? DEFAULT_MAX_PASSTHROUGH_COUNT,
		showData: raw.showData ?? false,
		debug: raw.debug ?? false,
		distillRateFloor: raw.distillRateFloor ?? DEFAULT_DISTILL_RATE_FLOOR,
		enabled: raw.enabled ?? true,
	};
}

export interface LoadConfigResult {
	config: ImpressionConfig;
	/** Human-readable warnings produced during loading (e.g. JSON parse errors per-file). Caller is responsible for surfacing them via `ctx.ui.notify` once a UI context is available. */
	warnings: string[];
}

interface LoadJsonResult {
	config: ImpressionConfig | null;
	parseError?: string;
}

function loadJsonConfig(path: string): LoadJsonResult {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		// Missing file is the normal case — not an error.
		return { config: null };
	}
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return { config: parsed as ImpressionConfig };
		}
		return { config: null, parseError: `${path}: top-level JSON value is not an object — file ignored.` };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { config: null, parseError: `${path}: JSON parse error — file ignored. ${msg}` };
	}
}

export function loadConfig(): LoadConfigResult {
	const warnings: string[] = [];
	const globalRes = loadJsonConfig(join(getAgentDir(), CONFIG_FILE_NAME));
	if (globalRes.parseError) warnings.push(globalRes.parseError);
	const localRes = loadJsonConfig(join(process.cwd(), ".pi", CONFIG_FILE_NAME));
	if (localRes.parseError) warnings.push(localRes.parseError);
	return {
		config: { ...globalRes.config, ...localRes.config },
		warnings,
	};
}

export async function saveLocalConfig(patch: Partial<ImpressionConfig>): Promise<void> {
	const dir = join(process.cwd(), ".pi");
	const path = join(dir, CONFIG_FILE_NAME);
	const existing = loadJsonConfig(path).config ?? {};
	const merged = { ...existing, ...patch };
	const tmp = join(dir, `${CONFIG_FILE_NAME}.${randomUUID().slice(0, 8)}.tmp`);
	await mkdir(dir, { recursive: true });
	await writeFile(tmp, JSON.stringify(merged, null, "\t") + "\n", "utf-8");
	// rename(2) is atomic within the same filesystem — no half-written file is ever
	// observable. Concurrent invocations are NOT serialized: each call reads its
	// own baseline, merges its patch, and atomic-renames independently. The LATER
	// rename overwrites the EARLIER one, and the earlier writer's patch is lost
	// ENTIRELY (not merely reordered) — the later writer's on-disk result is
	// (later-baseline ∪ later-patch), with no awareness of the earlier patch that
	// briefly existed between the two reads. Acceptable for a manual user command.
	try {
		await rename(tmp, path);
	} catch (err) {
		// Cross-FS rename (EXDEV) or any other rename failure: clean up the tmp
		// file so it doesn't litter .pi/. Swallow unlink errors — best-effort.
		await unlink(tmp).catch(() => {});
		throw err;
	}
}

export function shouldSkipDistillation(toolName: string, config: ResolvedConfig): boolean {
	const patterns = config.skipDistillation;
	if (patterns.length === 0) return false;
	for (const pattern of patterns) {
		if (pattern.length >= 2 && pattern.startsWith("/") && pattern.endsWith("/")) {
			try {
				if (new RegExp(pattern.slice(1, -1)).test(toolName)) return true;
			} catch {
				// invalid regex — fall through to other matchers
			}
			continue;
		}
		if (pattern === toolName) return true;
		if (pattern.endsWith("*") && toolName.startsWith(pattern.slice(0, -1))) return true;
	}
	return false;
}
