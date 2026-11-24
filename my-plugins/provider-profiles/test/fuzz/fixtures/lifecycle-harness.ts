/**
 * Harness for the lifecycle sequence fuzz: fake clock, fake fetch with all
 * documented response modes, and a deferred-fetch mode that models a late
 * background job resolving after dispose. No real network, no real waits.
 */

import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import type { CatalogOwner } from "../../official-catalog/catalog-owner.js";
import { validRecord, zaiFixtureSource } from "./wire-corpus.js";

export const FAR_FUTURE = 4_102_444_800_000;
export const SUCCESS_TTL_MS = 4 * 60 * 60 * 1000;
export const MODES = [
	"takeover", "stale-catalog", "304", "304-then-200", "no-data", "rate-limit", "http-5xx",
	"invalid-json", "deferred",
] as const;
export type Mode = (typeof MODES)[number];

export interface SequenceState {
	owner: CatalogOwner | undefined;
	agentDir: string;
	clock: number;
	mode: Mode;
	takeoverId: string;
	calls: number;
	deferred: { resolve: () => void } | undefined;
	notifications: { message: string; level: string; resolutions: number; buffered: boolean }[];
	resolutions: number;
	attachedOnce: boolean;
	updates: string[];
	updatedAfterDispose: string[];
	disposed: boolean;
	visible: Set<string>;
	visibleAtDispose: ReadonlySet<string>;
	committedTakeover: string | undefined;
	writeBlocked: boolean;
}

const source = zaiFixtureSource();
let served304 = false;

/** Recovery clock for the warning-dedup oracle: one tick per served fetch
 * response that proves a completed catalog check a commit can land on —
 * classified from HTTP semantics and the fixture's own bodies, never from
 * the product's dedup state. 2xx counts only when the fixture knows the
 * body is a well-formed catalog document (invalid-json is a parse failure,
 * not a recovery); 404 is an explicit no-data answer that still commits;
 * 304 counts only when it answers a conditional request the client actually
 * sent (a 304 to a non-conditional GET is a bogus exchange — the client
 * must refetch, so that exchange proves nothing). Write-blocked runs cannot
 * commit and disposed runs are stale-checked out of the job; the deferred
 * response always resolves after dispose in this harness. */
function servedRecovery(state: SequenceState, response: Response, validatorSent: boolean): boolean {
	if (state.writeBlocked || state.disposed) return false;
	if (response.status === 304) return validatorSent;
	if (response.status === 404) return true;
	if (!(response.status >= 200 && response.status <= 299)) return false;
	return state.mode !== "invalid-json";
}

export function resetHarness(state: SequenceState): typeof globalThis.fetch {
	served304 = false;
	return (async (_url: unknown, init?: RequestInit) => {
		state.calls += 1;
		const headers = init?.headers as Record<string, string> | undefined;
		const validatorSent = headers?.["if-none-match"] !== undefined;
		if (state.mode === "deferred") {
			return new Promise<Response>((resolve) => {
				state.deferred = { resolve: () => resolve(responseFor(state, "takeover")) };
			});
		}
		let response: Response;
		if (state.mode === "304-then-200") {
			response = served304 ? responseFor(state, "takeover") : new Response(null, { status: 304 });
			served304 = true;
		} else {
			response = responseFor(state, state.mode);
		}
		if (servedRecovery(state, response, validatorSent)) state.resolutions += 1;
		return response;
	}) as typeof globalThis.fetch;
}

function responseFor(state: SequenceState, mode: Mode): Response {
	const body = JSON.stringify([{ ...validRecord(source, state.takeoverId) }]);
	switch (mode) {
		case "takeover":
			return new Response(body, { status: 200, headers: { "last-modified": new Date(FAR_FUTURE).toUTCString(), etag: `"w-${state.takeoverId}"` } });
		case "stale-catalog":
			return new Response(body, { status: 200, headers: { "last-modified": new Date(0).toUTCString() } });
		case "304":
		case "304-then-200":
			return new Response(null, { status: 304 });
		case "no-data":
			return new Response("not found", { status: 404 });
		case "rate-limit":
			return new Response("slow down", { status: 429, headers: { "retry-after": "1" } });
		case "http-5xx":
			return new Response("boom", { status: 503 });
		case "invalid-json":
			return new Response('{"models": [', { status: 200 });
	}
}

export function refreshContext(allowNetwork: boolean, force?: boolean): RefreshModelsContext {
	return {
		publish: async () => true,
		allowNetwork,
		force,
		signal: new AbortController().signal,
	};
}

export async function settle(): Promise<void> {
	for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
}
