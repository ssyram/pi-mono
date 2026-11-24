/**
 * Private official-catalog cache (docs/official-catalog-sync.md D2/D5 +
 * P/M CacheV1). Files live only in the plugin-owned directory under the host
 * agent dir and are keyed by the closed source id set. Writes use a unique
 * 0600 temp file and an atomic rename after the generation/cancel check, so
 * concurrent readers only ever observe a complete valid snapshot and a
 * crashed write leaves the previous one intact. A miss never throws across
 * the compose boundary and never disables later network refreshes.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CacheRead, CacheV1, CacheWrite, CatalogSource } from "./catalog-contracts.js";
import { readOverlayModel } from "./overlay-model.js";

const MAX_CACHE_BYTES = 16 * 1024 * 1024;

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function sameStringSet(stored: unknown, expected: readonly string[]): boolean {
	if (!Array.isArray(stored) || stored.length !== expected.length) return false;
	const sorted = [...stored].sort();
	const reference = [...expected].sort();
	return sorted.every((value, index) => value === reference[index]);
}

function validModels(value: unknown, source: CatalogSource): CacheV1["models"] | undefined {
	if (!Array.isArray(value)) return undefined;
	const models: CacheV1["models"] = [];
	for (const entry of value) {
		const model = readOverlayModel(entry, source);
		if (model === undefined) return undefined;
		models.push(model);
	}
	return models;
}

/** ENOENT is a normal miss; unreadable/invalid/mismatch are cacheability
 * misses with a reason the caller can warn about once. */
export async function readCatalogCache(path: string, source: CatalogSource): Promise<CacheRead> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return { type: "miss", reason: code === "ENOENT" ? "missing" : "unreadable" };
	}
	if (raw.length > MAX_CACHE_BYTES) return { type: "miss", reason: "invalid" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { type: "miss", reason: "invalid" };
	}
	if (typeof parsed !== "object" || parsed === null) return { type: "miss", reason: "invalid" };
	const snapshot = parsed as Record<string, unknown>;
	if (snapshot.version !== 1) return { type: "miss", reason: "invalid" };
	if (snapshot.sourceId !== source.sourceId) return { type: "miss", reason: "mismatch" };
	if (snapshot.baseUrl !== source.endpoint) return { type: "miss", reason: "mismatch" };
	if (!sameStringSet(snapshot.apiSet, source.apiSet)) return { type: "miss", reason: "mismatch" };
	if (!finiteNumber(snapshot.checkedAt) || !finiteNumber(snapshot.retryAt)) {
		return { type: "miss", reason: "invalid" };
	}
	if (snapshot.etag !== undefined && typeof snapshot.etag !== "string") return { type: "miss", reason: "invalid" };
	if (snapshot.lastModified !== undefined && !finiteNumber(snapshot.lastModified)) {
		return { type: "miss", reason: "invalid" };
	}
	const models = validModels(snapshot.models, source);
	if (models === undefined) return { type: "miss", reason: "invalid" };
	return {
		type: "hit",
		cache: {
			version: 1,
			sourceId: source.sourceId,
			apiSet: [...source.apiSet].sort(),
			baseUrl: source.endpoint,
			models,
			checkedAt: snapshot.checkedAt,
			retryAt: snapshot.retryAt,
			...(snapshot.lastModified === undefined ? {} : { lastModified: snapshot.lastModified }),
			...(snapshot.etag === undefined ? {} : { etag: snapshot.etag }),
		},
	};
}

function tempName(sourceId: string): string {
	return `.${sourceId}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
}

async function discard(path: string): Promise<void> {
	try {
		await rm(path, { force: true });
	} catch {
		// Only this module's own unique temp file is affected; the next write
		// uses a fresh name and readers ignore temp names.
	}
}

export async function writeCatalogCache(path: string, cache: CacheV1, signal: AbortSignal): Promise<CacheWrite> {
	const temp = join(dirname(path), tempName(cache.sourceId));
	try {
		await mkdir(dirname(path), { recursive: true });
		if (signal.aborted) {
			await discard(temp);
			return { type: "failed", reason: "aborted" };
		}
		await writeFile(temp, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
		if (signal.aborted) {
			await discard(temp);
			return { type: "failed", reason: "aborted" };
		}
		await rename(temp, path);
		return { type: "written" };
	} catch {
		await discard(temp);
		return { type: "failed", reason: "io" };
	}
}
