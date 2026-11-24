/**
 * Data contracts for the official pi.dev catalog sync layer
 * (docs/official-catalog-sync.md P/M + D). Tagged unions keep miss, failure,
 * and valid-empty outcomes distinct. CacheV1 and every fetch outcome are
 * credential-free by construction: no auth headers, no env values, no
 * account-private data ever crosses this boundary.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

export type CatalogFailureKind =
	| "network"
	| "timeout"
	| "rate-limit"
	| "http"
	| "invalid"
	| "disposed"
	| "cache-write";

/** One adapted static official source (catalog-source.ts). */
export interface CatalogSource {
	readonly sourceId: string;
	/** Fixed pi.dev URL derived from sourceId, never from a profile name. */
	readonly catalogUrl: string;
	/** The original source's verified endpoint; never rewritten. */
	readonly endpoint: string;
	/** APIs the original instance can handle; overlay apis must be a member. */
	readonly apiSet: readonly string[];
}

export type OverlayModel = Model<Api>;

/** Private on-disk snapshot (catalog-cache.ts). Flat CacheV1 per contract. */
export interface CacheV1 {
	version: 1;
	sourceId: string;
	apiSet: string[];
	baseUrl: string;
	models: OverlayModel[];
	checkedAt: number;
	retryAt: number;
	lastModified?: number;
	etag?: string;
}

export type CacheRead =
	| { type: "hit"; cache: CacheV1 }
	| { type: "miss"; reason: "missing" | "unreadable" | "invalid" | "mismatch" };

export type CacheWrite = { type: "written" } | { type: "failed"; reason: "aborted" | "io" };

export type FetchOutcome =
	| { outcome: "updated"; value: unknown; etag?: string; lastModified?: number }
	| { outcome: "unchanged" }
	| { outcome: "no-data" }
	| { outcome: "failed"; kind: CatalogFailureKind; retryAfterMs?: number };

export interface FetchRequest {
	readonly url: string;
	readonly etag?: string;
	readonly timeoutMs: number;
	readonly signal: AbortSignal;
}

export type CatalogFetch = (request: FetchRequest) => Promise<FetchOutcome>;

export type ParseResult = { type: "valid"; models: OverlayModel[] } | { type: "invalid" };
