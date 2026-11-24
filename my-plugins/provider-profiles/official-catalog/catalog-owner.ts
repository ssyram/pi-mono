/**
 * Official-catalog owner and creation-time composition
 * (docs/official-catalog-sync.md P/M + D6). Both the startup factory and
 * /add-login call the same compose entry before registerProvider: await the
 * local private snapshot, then return a provider whose catalog is the
 * original instance list plus the valid official overlay. The wrapped
 * instance shares the original's id/auth/headers/baseUrl/transport objects
 * by reference; only getModels and refreshModels are composed. Any
 * creation/cache/validation anomaly returns the original instance — the
 * catalog sync can never make an account fail to register.
 */

import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { getBuiltinModelDataGeneratedAt } from "@earendil-works/pi-ai/providers/all";
import { readCatalogCache } from "./catalog-cache.js";
import type { CacheRead, OverlayModel } from "./catalog-contracts.js";
import { mergeOfficial } from "./catalog-merge.js";
import { catalogNewer, createCatalogRefreshModels, type CatalogRuntimeDeps, type SourceRuntime } from "./catalog-refresh.js";
import { catalogCachePath, resolveCatalogSource } from "./catalog-source.js";
import { createWarningSink, type WarningLevel, type WarningSink } from "./catalog-warnings.js";

export interface CatalogDeps {
	readonly fetch?: typeof globalThis.fetch;
	readonly now?: () => number;
	readonly requestTimeoutMs?: number;
	readonly generatedAt?: () => number | undefined;
}

export interface CatalogHooks {
	readonly notify: (message: string, level: WarningLevel) => void;
	readonly onUpdated: (ids: readonly string[]) => Promise<void>;
}

export interface CatalogOwner {
	compose(original: Provider, sourceId: string): Promise<Provider>;
	attach(hooks: CatalogHooks): void;
	dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function restoreOverlay(read: CacheRead, generatedAt: () => number | undefined): readonly OverlayModel[] {
	if (read.type === "miss") return [];
	return catalogNewer(read.cache.lastModified, generatedAt()) ? read.cache.models : [];
}

function warnCacheMiss(sink: WarningSink, sourceId: string, reason: string): void {
	if (reason === "missing") return;
	sink.warn(
		`${sourceId}:cache-read`,
		`cached official catalog for ${sourceId} is unusable (${reason}); keeping the current model list until the next refresh`,
	);
}

function createRuntime(
	source: SourceRuntime["source"],
	cachePath: string,
	read: CacheRead,
	deps: CatalogRuntimeDeps,
	sink: WarningSink,
	emitUpdate: ((ids: readonly string[]) => Promise<void>) | undefined,
): SourceRuntime {
	if (read.type === "miss") warnCacheMiss(sink, source.sourceId, read.reason);
	const hit = read.type === "hit" ? read.cache : undefined;
	return {
		source,
		cachePath,
		deps,
		sink,
		instances: new Set<string>(),
		disposed: false,
		generation: 0,
		pending: undefined,
		overlay: hit ? restoreOverlay(read, deps.generatedAt) : [],
		clock: hit
			? {
					checkedAt: hit.checkedAt,
					retryAt: hit.retryAt,
					...(hit.lastModified === undefined ? {} : { lastModified: hit.lastModified }),
					...(hit.etag === undefined ? {} : { etag: hit.etag }),
				}
			: { checkedAt: 0, retryAt: 0 },
		emitUpdate,
	};
}

function wrapCatalogInstance(original: Provider, runtime: SourceRuntime): Provider {
	const instanceCatalog = (): readonly Model<Api>[] =>
		runtime.disposed
			? (original.getModels() as readonly Model<Api>[])
			: mergeOfficial(original.getModels() as readonly Model<Api>[], runtime.overlay, original.id);
	return {
		...original,
		getModels: instanceCatalog,
		refreshModelsAuth: "configured",
		refreshModels: createCatalogRefreshModels(runtime, original),
	};
}

export function createCatalogOwner(agentDir: string, deps: CatalogDeps = {}): CatalogOwner {
	const disabled = process.env.PI_PROFILE_CATALOG_SYNC === "0";
	const sink = createWarningSink();
	const resolved: CatalogRuntimeDeps = {
		fetch: deps.fetch ?? globalThis.fetch,
		now: deps.now ?? Date.now,
		requestTimeoutMs: deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
		generatedAt: deps.generatedAt ?? getBuiltinModelDataGeneratedAt,
	};
	const runtimes = new Map<string, SourceRuntime>();
	let attached: CatalogHooks | undefined;
	let closed = false;
	return {
		async compose(original, sourceId) {
			try {
				if (disabled || closed) return original;
				const source = resolveCatalogSource(original, sourceId);
				if (source === undefined) return original;
				const cachePath = catalogCachePath(agentDir, sourceId);
				let runtime = runtimes.get(sourceId);
				if (runtime === undefined) {
					const read = await readCatalogCache(cachePath, source);
					if (closed) return original;
					runtime = createRuntime(source, cachePath, read, resolved, sink, attached?.onUpdated);
					runtimes.set(sourceId, runtime);
				}
				runtime.instances.add(original.id);
				return wrapCatalogInstance(original, runtime);
			} catch {
				return original;
			}
		},
		attach(hooks) {
			if (closed) return;
			attached = hooks;
			sink.attach(hooks.notify);
			for (const runtime of runtimes.values()) runtime.emitUpdate = hooks.onUpdated;
		},
		dispose() {
			if (closed) return;
			closed = true;
			for (const runtime of runtimes.values()) {
				runtime.disposed = true;
				runtime.generation += 1;
				runtime.emitUpdate = undefined;
				runtime.pending?.abort();
			}
		},
	};
}
