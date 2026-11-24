/** Per-instance model catalog: official CN coding-plan metadata, gateway-driven replacement. */
import { defaultProviderAuthContext, type ApiKeyCredential, type Credential, type Model, type Provider, type RefreshModelsContext } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { backendFailure, toProviderError, type BackendResult } from "./backend-failure.js";
import type { ApiKeyAuth } from "@earendil-works/pi-ai";

/** Z.ai defaults lost when provider id/baseUrl no longer match auto-detection (openai-completions). */
const ZAI_COMPAT_DEFAULTS = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	maxTokensField: "max_tokens" as const,
	thinkingFormat: "zai" as const,
};

export type CatalogState =
	| { kind: "baseline"; models: readonly Model[] }
	| { kind: "ready"; models: readonly Model[]; checkedAtMs: number };

export interface ModelCatalog {
	models(): readonly Model[];
	refresh(context: RefreshModelsContext): Promise<void>;
}

export function createMetadataIndex(provider: Provider): ReadonlyMap<string, Model> {
	const index = new Map<string, Model>();
	for (const model of provider.getModels()) index.set(model.id, model);
	if (index.size === 0) throw new Error("metadata provider has no models");
	return index;
}

export function findMetadataProvider(providers: readonly Provider[]): Provider {
	const provider = providers.find((candidate) => candidate.id === "zai-coding-cn");
	if (!provider) throw new Error("zai-coding-cn metadata provider unavailable");
	return provider;
}

export function officialMetadataProvider(): Provider {
	return findMetadataProvider(builtinProviders());
}

export function bindModel(metadata: Model, profileId: string, relayUrl: string): Model {
	return {
		...metadata,
		provider: profileId,
		baseUrl: relayUrl,
		compat: { ...ZAI_COMPAT_DEFAULTS, ...(metadata.compat ?? {}) },
	};
}

const FRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export async function fetchModelIds(
	relayBaseUrl: string,
	apiKey: string,
	signal: AbortSignal,
): Promise<BackendResult<readonly string[]>> {
	if (signal.aborted) return { kind: "cancelled" };
	let response: Response;
	try {
		response = await fetch(`${relayBaseUrl}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
		});
	} catch (error) {
		if (signal.aborted) return { kind: "cancelled" };
		return backendFailure("network", "list gateway models", String(error));
	}
	if (!response.ok) return backendFailure("http", "list gateway models", response.status);
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return backendFailure("invalid-response", "list gateway models");
	}
	const data = (body as { data?: unknown } | null)?.data;
	if (!Array.isArray(data)) return backendFailure("invalid-response", "list gateway models");
	const ids: string[] = [];
	for (const entry of data) {
		const id = (entry as { id?: unknown } | null)?.id;
		if (typeof id !== "string") return backendFailure("invalid-response", "list gateway models");
		const trimmed = id.trim();
		if (trimmed !== "" && !ids.includes(trimmed)) ids.push(trimmed);
	}
	return { kind: "ok", value: ids };
}

function apikeyCredential(credential: Credential | undefined): ApiKeyCredential | undefined {
	return credential?.type === "api_key" ? credential : undefined;
}

/** Baseline = every known official model bound to the instance; a successful gateway list
 * REPLACES it (intersection), so removed gateway models disappear. No persisted member cache. */
export function createModelCatalog(
	profileId: string,
	auth: ApiKeyAuth,
	metadata: ReadonlyMap<string, Model>,
	relayBaseUrl: string,
	ensureBackend: (signal: AbortSignal) => Promise<BackendResult<string>>,
): ModelCatalog {
	let state: CatalogState = {
		kind: "baseline",
		models: [...metadata.values()].map((model) => bindModel(model, profileId, relayBaseUrl)),
	};
	return {
		models() {
			return state.models;
		},
		async refresh(context) {
			if (context.signal.aborted) return;
			if (!context.allowNetwork) return;
			if (!context.force && state.kind === "ready" && Date.now() - state.checkedAtMs < FRESH_MS) return;
			const credential = apikeyCredential(context.credential);
			const resolved = await auth.resolve({
				ctx: defaultProviderAuthContext(),
				...(credential ? { credential } : {}),
				signal: context.signal,
			});
			if (context.signal.aborted) return;
			if (!resolved?.auth.apiKey) return;
			const info = await ensureBackend(context.signal);
			if (info.kind !== "ok") {
				if (info.kind === "cancelled" || context.signal.aborted) return;
				throw toProviderError(info);
			}
			const listed = await fetchModelIds(info.value, resolved.auth.apiKey, context.signal);
			if (listed.kind !== "ok") {
				if (listed.kind === "cancelled" || context.signal.aborted) return;
				throw toProviderError(listed);
			}
			const models: Model[] = [];
			for (const id of listed.value) {
				const source = metadata.get(id);
				if (source) models.push(bindModel(source, profileId, relayBaseUrl));
			}
			const published = await context.publish({
				update: () => {
					state = { kind: "ready", models, checkedAtMs: Date.now() };
				},
			});
			void published;
		},
	};
}
