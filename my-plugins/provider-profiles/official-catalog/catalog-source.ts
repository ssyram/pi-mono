/**
 * Catalog source resolution (docs/official-catalog-sync.md D1). A source
 * adapts only when its id is one of the static official builtin sources and
 * the live instance catalog yields a non-empty api set plus one verified
 * endpoint. Failure returns undefined with no side effects; endpoints are
 * never rewritten to make a source match.
 */

import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { supportedSourceIds } from "../provider-source.js";
import type { CatalogSource } from "./catalog-contracts.js";

const CATALOG_BASE_URL = "https://pi.dev";

/** Fixed URL per sourceId (never derived from a profile name). */
export function officialCatalogUrl(sourceId: string): string {
	const catalogPath = `/api/models/providers/${encodeURIComponent(sourceId)}`;
	return `${CATALOG_BASE_URL}${catalogPath}?types=chat`;
}

/** Private cache location under the host agent dir, keyed by sourceId. */
export function catalogCachePath(agentDir: string, sourceId: string): string {
	return join(agentDir, "provider-profiles", "official-catalog", `${sourceId}.json`);
}

function verifiedEndpoint(original: Provider, catalog: readonly Model<Api>[]): string | undefined {
	if (original.baseUrl !== undefined) return original.baseUrl;
	const endpoints = new Set(catalog.map((model) => model.baseUrl));
	return endpoints.size === 1 ? [...endpoints][0] : undefined;
}

export function resolveCatalogSource(original: Provider, sourceId: string): CatalogSource | undefined {
	if (!supportedSourceIds().includes(sourceId)) return undefined;
	const catalog = original.getModels() as readonly Model<Api>[];
	if (catalog.length === 0) return undefined;
	const endpoint = verifiedEndpoint(original, catalog);
	if (endpoint === undefined) return undefined;
	const apiSet = [...new Set(catalog.map((model) => model.api))];
	return { sourceId, catalogUrl: officialCatalogUrl(sourceId), endpoint, apiSet };
}
