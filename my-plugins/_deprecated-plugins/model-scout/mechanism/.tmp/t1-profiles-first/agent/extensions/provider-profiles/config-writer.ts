/**
 * Read-modify-write persistence for provider-profiles.json (C5). The merged
 * result always re-passes the C1 validator so the file content only ever
 * takes shapes the loader accepts; errors about other pre-existing entries
 * are tolerated exactly as the loader tolerates them at startup.
 * Writes go to a sibling temp file followed by rename (same-directory
 * atomicity). Concurrent writers from other sessions may interleave — last
 * rename wins; documented boundary, no cross-process locking.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProfileEntry, ValidationContext } from "./config-entry.js";
import { parseEntries } from "./config-entry.js";
import type { RawProfileConfig } from "./config-loader.js";

export type UpsertResult = { ok: true; entry: ProfileEntry } | { ok: false; error: string };

export async function upsertProfileEntry(
	path: string,
	entry: ProfileEntry,
	validation: ValidationContext,
): Promise<UpsertResult> {
	let raw: RawProfileConfig = {};
	try {
		raw = JSON.parse(await readFile(path, "utf-8")) as RawProfileConfig;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			return { ok: false, error: `existing config unreadable: ${error instanceof Error ? error.message : String(error)}` };
		}
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { ok: false, error: "existing config is not a JSON object" };
	}
	const merged: Record<string, unknown> = { ...raw };
	merged[entry.name] =
		entry.apiKey === undefined ? { provider: entry.provider } : { provider: entry.provider, apiKey: entry.apiKey };
	const { errors } = parseEntries(merged, validation);
	const ownError = errors.find((item) => item.name === entry.name);
	if (ownError !== undefined) {
		return { ok: false, error: ownError.reason };
	}
	const tempPath = join(dirname(path), "provider-profiles.json.tmp");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(tempPath, `${JSON.stringify(merged, null, "\t")}\n`, "utf-8");
	await rename(tempPath, path);
	return { ok: true, entry };
}
