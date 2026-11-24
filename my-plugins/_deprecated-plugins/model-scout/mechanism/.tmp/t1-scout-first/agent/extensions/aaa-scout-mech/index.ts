/**
 * scout-mech — MECHANISM TRIAL EXTENSION for model-scout design-v2 §5.
 *
 * NOT product code. It exists to prove, against the real installed loader /
 * SDK / faux provider, that:
 *  - registering nothing at load time keeps provider-profiles natives intact
 *    in BOTH extension load orders;
 *  - a post-bind native wrapper (registered at session_start, restored at
 *    session_shutdown) preserves identity / auth / transport by reference;
 *  - the wrapper's refreshModels participates in every host refresh
 *    (restore phase reads the plugin cache; network phase fetches discovery,
 *    validates, writes last-good atomically; official store is never written);
 *  - supplements merge live behind the official list (official-first dedup),
 *    so an official takeover removes them without touching official objects;
 *  - reload/disable leave no stacked wrappers and no stale tasks.
 *
 * Logging: JSONL to $SCOUT_LOG for trial timing evidence.
 * Cache root: <agentDir>/model-scout-cache (plugin-owned; location policy is
 * a detailed-design decision, not part of this proof).
 * Discovery endpoint: $SCOUT_DISCOVERY_URL (trial-local mock; product policy
 * belongs to source-policy/discovery modules).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Provider, Model, RefreshModelsContext } from "@earendil-works/pi-ai";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

interface CachedModel {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

interface CacheEntry {
	version: 1;
	endpoint: string;
	checkedAt: number;
	models: CachedModel[];
}

function log(event: string, data: Record<string, unknown> = {}): void {
	const path = process.env.SCOUT_LOG;
	if (!path) return;
	try {
		writeFileSync(path, `${JSON.stringify({ t: Date.now(), event, ...data })}\n`, { flag: "a" });
	} catch {
		/* trial logging must never break the mechanism */
	}
}

function cacheRoot(): string {
	return join(getAgentDir(), "model-scout-cache");
}

function cachePath(providerId: string): string {
	return join(cacheRoot(), `${providerId}.json`);
}

function readCache(providerId: string): CacheEntry | undefined {
	try {
		const raw = JSON.parse(readFileSync(cachePath(providerId), "utf-8"));
		if (raw && raw.version === 1 && Array.isArray(raw.models) && typeof raw.endpoint === "string") {
			return raw as CacheEntry;
		}
		return undefined;
	} catch {
		return undefined; // unreadable cache is a cache-miss, never an error
	}
}

function writeCacheAtomic(providerId: string, entry: CacheEntry): void {
	mkdirSync(cacheRoot(), { recursive: true });
	const target = cachePath(providerId);
	const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(entry, null, "\t"));
	renameSync(tmp, target);
}

/** Official template api: the transport the original provider already serves. */
function officialApi(original: Provider): string | undefined {
	return original.getModels().find((m) => (m.type ?? "chat") === "chat")?.api;
}

function validateCandidates(
	original: Provider,
	endpoint: string,
	candidates: unknown,
): { models: CachedModel[]; dropped: number } {
	if (!Array.isArray(candidates)) return { models: [], dropped: 0 };
	const api = officialApi(original);
	const out: CachedModel[] = [];
	const seen = new Set<string>();
	let dropped = 0;
	for (const raw of candidates) {
		if (typeof raw !== "object" || raw === null) { dropped++; continue; }
		const c = raw as Record<string, unknown>;
		if (typeof c.id !== "string" || c.id.length === 0 || seen.has(c.id)) { dropped++; continue; }
		if (c.api !== undefined && c.api !== api) { dropped++; continue; }
		const contextWindow = typeof c.contextWindow === "number" ? c.contextWindow : 128000;
		const maxTokens = typeof c.maxTokens === "number" ? c.maxTokens : 16384;
		if (contextWindow <= 0 || maxTokens <= 0) { dropped++; continue; }
		seen.add(c.id);
		out.push({
			id: c.id,
			name: typeof c.name === "string" ? c.name : c.id,
			api,
			reasoning: c.reasoning === true,
			contextWindow,
			maxTokens,
		});
	}
	return { models: out, dropped };
}

function toModel(original: Provider, cached: CachedModel): Model {
	return {
		id: cached.id,
		name: cached.name ?? cached.id,
		api: (cached.api ?? officialApi(original) ?? "openai-completions") as Model["api"],
		provider: original.id,
		baseUrl: original.baseUrl,
		reasoning: cached.reasoning === true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: cached.contextWindow ?? 128000,
		maxTokens: cached.maxTokens ?? 16384,
	} as Model;
}

function modelKey(m: { id: string; type?: string }): string {
	return `${m.type ?? "chat"}\0${m.id}`;
}

/** Official list wins; supplements with the same (type,id) are dropped. */
function mergeBehindOfficial<T extends { id: string; type?: string }>(official: readonly T[], supplements: readonly T[]): T[] {
	const officialKeys = new Set(official.map(modelKey));
	return [...official, ...supplements.filter((m) => !officialKeys.has(modelKey(m)))];
}

interface WrappedEntry {
	original: Provider;
	wrapper: Provider;
	supplements: Model[];
}

async function fetchDiscovery(signal: AbortSignal): Promise<unknown> {
	const url = process.env.SCOUT_DISCOVERY_URL;
	if (!url) throw new Error("no discovery endpoint configured (SCOUT_DISCOVERY_URL)");
	const response = await fetch(url, { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`discovery http ${response.status}`);
	return response.json();
}

function restoreFromCache(entry: WrappedEntry): boolean {
	const original = entry.original;
	const cached = readCache(original.id);
	// Endpoint mismatch means the cache belongs to another account/endpoint: miss.
	if (!cached || cached.endpoint !== original.baseUrl) return false;
	entry.supplements = cached.models.map((m) => toModel(original, m));
	return true;
}

function makeWrapper(entry: WrappedEntry): Provider {
	const { original } = entry;
	const wrapper: Provider = {
		...original,
		getModels: () => mergeBehindOfficial(original.getModels(), entry.supplements),
		...(original.getAllModels
			? { getAllModels: () => mergeBehindOfficial(original.getAllModels!(), entry.supplements) }
			: {}),
		refreshModels: async (context: RefreshModelsContext) => {
			log("refresh_begin", {
				provider: original.id,
				allowNetwork: context.allowNetwork,
				aborted: context.signal.aborted,
				hasStored: context.stored !== undefined,
			});
			// Official chain first: official refresh behavior (incl. its own
			// models-store persistence) must survive the wrapper untouched.
			await original.refreshModels?.(context);
			if (context.signal.aborted) {
				log("refresh_abort_after_official", { provider: original.id });
				return;
			}
			// Cache phase (runs on every cycle, offline included).
			const restored = restoreFromCache(entry);
			log("cache_restore", { provider: original.id, restored, count: entry.supplements.length });
			if (!context.allowNetwork || context.signal.aborted) {
				log("refresh_restore_only", { provider: original.id });
				return;
			}
			// Network phase: background discovery behind a freshness policy.
			const ttlMs = Number(process.env.SCOUT_FRESH_MS ?? "0");
			const cached = readCache(original.id);
			if (cached && ttlMs > 0 && Date.now() - cached.checkedAt < ttlMs) {
				log("discovery_skipped_fresh", { provider: original.id });
				return;
			}
			try {
				log("discovery_fetch_begin", { provider: original.id });
				const payload = await fetchDiscovery(context.signal);
				if (context.signal.aborted) {
					// Late task after supersede/reload: no cache write, no publish.
					log("refresh_late_abort", { provider: original.id });
					return;
				}
				const validated = validateCandidates(original, original.baseUrl ?? "", payload);
				log("discovery_validated", {
					provider: original.id,
					count: validated.models.length,
					dropped: validated.dropped,
				});
				writeCacheAtomic(original.id, {
					version: 1,
					endpoint: original.baseUrl ?? "",
					checkedAt: Date.now(),
					models: validated.models,
				});
				entry.supplements = validated.models.map((m) => toModel(original, m));
				log("refresh_published", { provider: original.id, count: entry.supplements.length });
			} catch (error) {
				// Last-good: keep the cached supplements; official set untouched.
				log("refresh_network_failed_keep_last_good", {
					provider: original.id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	};
	return wrapper;
}

/** Re-apply the session's saved model selection once supplements are visible. */
function restoreSavedSelection(pi: ExtensionAPI, ctx: { modelRegistry: { find: (p: string, id: string) => Model | undefined }; sessionManager: { getBranch: () => Array<Record<string, unknown>> } }): void {
	try {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as { type?: string; provider?: string; modelId?: string };
			if (entry?.type !== "model_change") continue;
			if (typeof entry.provider === "string" && typeof entry.modelId === "string") {
				const model = ctx.modelRegistry.find(entry.provider, entry.modelId);
				if (model) {
					void pi
						.setModel(model)
						.then((ok) => log("saved_selection_restored", { provider: entry.provider, modelId: entry.modelId, ok }))
						.catch((e) => log("saved_selection_restore_failed", { error: String(e) }));
				} else {
					log("saved_selection_not_in_catalog", { provider: entry.provider, modelId: entry.modelId });
				}
			}
			break;
		}
	} catch (error) {
		log("saved_selection_error", { error: error instanceof Error ? error.message : String(error) });
	}
}

export default function scoutMech(pi: ExtensionAPI): void {
	const wrapped = new Map<string, WrappedEntry>();

	pi.on("session_start", (event, ctx) => {
		log("session_start", { reason: (event as { reason?: string }).reason });
		const registry = ctx.modelRegistry;
		for (const id of registry.getRegisteredProviderIds()) {
			if (wrapped.has(id)) continue;
			const original = registry.getRegisteredNativeProvider(id);
			if (!original || typeof original.getModels !== "function") continue;
			const entry: WrappedEntry = { original, wrapper: undefined as unknown as Provider, supplements: [] };
			entry.wrapper = makeWrapper(entry);
			// Eager cache restore so supplements are visible the moment the
			// wrapper lands, not only after the next refresh cycle.
			restoreFromCache(entry);
			pi.registerProvider(entry.wrapper);
			wrapped.set(id, entry);
			log("wrapped", {
				id,
				authPreserved: entry.wrapper.auth === original.auth,
				streamPreserved: entry.wrapper.stream === original.stream,
			});
		}
		restoreSavedSelection(pi, ctx);
	});

	pi.on("session_shutdown", (event, ctx) => {
		const reason = (event as { reason?: string }).reason;
		log("session_shutdown", { reason, wrapped: [...wrapped.keys()] });
		// Restore the exact original objects so a reload (with or without this
		// plugin) starts from the pre-wrap state. unregisterProvider would
		// delete the id entirely; re-registration restores precisely.
		for (const [id, entry] of wrapped) {
			pi.registerProvider(entry.original);
			log("restored_original", { id, reason });
		}
		wrapped.clear();
	});

	log("loaded", { pid: process.pid });
}
