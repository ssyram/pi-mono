/**
 * SWR refresh lifecycle for one official catalog source
 * (docs/official-catalog-sync.md D7/D8). refreshModels is a pure cache-phase
 * publish (update-only, never persisting into the official models-store);
 * network work happens in a single-flight background job owned by the source
 * runtime and is never awaited by the refresh call. Every await inside the
 * job is followed by a generation/disposed check so a late or disposed job
 * can never publish. Failures keep lastGood with a bounded retryAt instead
 * of a poll loop; the private cache is committed before lastGood is
 * replaced.
 */

import type { Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import { getBuiltinModelDataGeneratedAt } from "@earendil-works/pi-ai/providers/all";
import { writeCatalogCache } from "./catalog-cache.js";
import type { CacheV1, CatalogFailureKind, CatalogSource, OverlayModel } from "./catalog-contracts.js";
import { fetchOfficialCatalog } from "./catalog-fetch.js";
import { parseCatalog } from "./catalog-parse.js";
import type { WarningSink } from "./catalog-warnings.js";

export const SUCCESS_TTL_MS = 4 * 60 * 60 * 1000;
export const FAILURE_RETRY_MS = 60 * 1000;

export interface CatalogRuntimeDeps {
	readonly fetch: typeof globalThis.fetch;
	readonly now: () => number;
	readonly requestTimeoutMs: number;
	readonly generatedAt: () => number | undefined;
}

export interface CatalogClock {
	checkedAt: number;
	retryAt: number;
	etag?: string;
	lastModified?: number;
}

export interface SourceRuntime {
	readonly source: CatalogSource;
	readonly cachePath: string;
	readonly deps: CatalogRuntimeDeps;
	readonly sink: WarningSink;
	readonly instances: Set<string>;
	disposed: boolean;
	generation: number;
	pending: AbortController | undefined;
	overlay: readonly OverlayModel[];
	clock: CatalogClock;
	emitUpdate: ((ids: readonly string[]) => Promise<void>) | undefined;
}

/** Official version rule: an overlay applies only when its Last-Modified is
 * newer than the bundled catalog generation (a missing generation accepts). */
export function catalogNewer(lastModified: number | undefined, generatedAt: number | undefined): boolean {
	return generatedAt === undefined || (lastModified !== undefined && lastModified > generatedAt);
}

function stale(runtime: SourceRuntime, generation: number): boolean {
	return runtime.disposed || runtime.generation !== generation;
}

function failureRetryMs(kind: CatalogFailureKind, hintMs: number | undefined): number {
	return kind === "rate-limit" && hintMs !== undefined ? Math.max(hintMs, FAILURE_RETRY_MS) : FAILURE_RETRY_MS;
}

function cacheEntry(runtime: SourceRuntime, models: readonly OverlayModel[], clock: CatalogClock): CacheV1 {
	return {
		version: 1,
		sourceId: runtime.source.sourceId,
		apiSet: [...runtime.source.apiSet].sort(),
		baseUrl: runtime.source.endpoint,
		models: [...models],
		checkedAt: clock.checkedAt,
		retryAt: clock.retryAt,
		...(clock.lastModified === undefined ? {} : { lastModified: clock.lastModified }),
		...(clock.etag === undefined ? {} : { etag: clock.etag }),
	};
}

async function notifyUpdated(runtime: SourceRuntime): Promise<void> {
	const emit = runtime.emitUpdate;
	if (emit === undefined || runtime.instances.size === 0) return;
	try {
		await emit([...runtime.instances]);
	} catch {
		// In-memory and private-cache state stay; the next ordinary host
		// refresh republishes visibility in its cache phase. No retry loop.
		runtime.sink.warn(
			`${runtime.source.sourceId}:sync`,
			"official catalog snapshot sync was rejected; the next ordinary refresh republishes it",
		);
	}
}

async function runCatalogJob(runtime: SourceRuntime): Promise<void> {
	const controller = new AbortController();
	runtime.pending = controller;
	const generation = runtime.generation;
	try {
		const { source, deps } = runtime;
		const etag = runtime.overlay.length > 0 ? runtime.clock.etag : undefined;
		const result = await fetchOfficialCatalog(deps.fetch, {
			url: source.catalogUrl,
			...(etag === undefined ? {} : { etag }),
			timeoutMs: deps.requestTimeoutMs,
			signal: controller.signal,
		});
		if (stale(runtime, generation)) return;
		const now = deps.now();
		if (result.outcome === "failed") {
			runtime.clock = {
				...runtime.clock,
				retryAt: now + failureRetryMs(result.kind, result.retryAfterMs),
			};
			runtime.sink.warn(
				`${source.sourceId}:fetch:${result.kind}`,
				`official catalog update failed for ${source.sourceId} (${result.kind}); keeping the last known model list`,
			);
			return;
		}
		let models = runtime.overlay;
		let clock: CatalogClock = { checkedAt: now, retryAt: 0 };
		let updated = false;
		if (result.outcome === "unchanged") {
			const { etag: keepEtag, lastModified } = runtime.clock;
			clock = {
				checkedAt: now,
				retryAt: 0,
				...(keepEtag === undefined ? {} : { etag: keepEtag }),
				...(lastModified === undefined ? {} : { lastModified }),
			};
		} else if (result.outcome === "no-data") {
			clock = { checkedAt: now, retryAt: 0, lastModified: 0 };
		} else {
			const parsed = parseCatalog(result.value, source);
			if (parsed.type === "invalid") {
				runtime.clock = { ...runtime.clock, retryAt: now + FAILURE_RETRY_MS };
				runtime.sink.warn(
					`${source.sourceId}:fetch:invalid`,
					`official catalog for ${source.sourceId} could not be validated; keeping the last known model list`,
				);
				return;
			}
			models = catalogNewer(result.lastModified, deps.generatedAt()) ? parsed.models : [];
			clock = {
				checkedAt: now,
				retryAt: 0,
				...(result.lastModified === undefined ? {} : { lastModified: result.lastModified }),
				...(result.etag === undefined ? {} : { etag: result.etag }),
			};
			updated = true;
		}
		const write = await writeCatalogCache(runtime.cachePath, cacheEntry(runtime, models, clock), controller.signal);
		if (stale(runtime, generation)) return;
		if (write.type === "failed") {
			runtime.clock = { ...runtime.clock, retryAt: now + FAILURE_RETRY_MS };
			runtime.sink.warn(
				`${source.sourceId}:cache-write`,
				"official catalog could not update its private cache; keeping the last known model list",
			);
			return;
		}
		runtime.overlay = models;
		runtime.clock = clock;
		runtime.sink.resolve(`${source.sourceId}:`);
		if (updated) await notifyUpdated(runtime);
	} finally {
		if (runtime.pending === controller) runtime.pending = undefined;
	}
}

export function createCatalogRefreshModels(runtime: SourceRuntime, original: Provider) {
	return async (context: RefreshModelsContext): Promise<void> => {
		if (original.refreshModels !== undefined) {
			await original.refreshModels(context);
		}
		if (runtime.disposed) return;
		if (!(await context.publish({ update: () => {} }))) return;
		if (!context.allowNetwork || context.signal.aborted || runtime.disposed) return;
		const now = runtime.deps.now();
		if (now < runtime.clock.retryAt) return;
		if (!(context.force === true || now >= runtime.clock.checkedAt + SUCCESS_TTL_MS)) return;
		if (runtime.pending !== undefined) return;
		void runCatalogJob(runtime).catch(() => {
			// Terminal guard: every await inside the job is individually
			// classified; this only guarantees no unhandled rejection escapes.
		});
	};
}
