/**
 * Official catalog GET (docs/official-catalog-sync.md D7 + robustness §4).
 * Credential-free by construction: no account headers, no auth tokens, no
 * env values are read or sent. Bodies are decoded chunk-by-chunk against a
 * hard 16 MiB cap — the stream is cancelled as soon as the cap is exceeded,
 * never buffered unboundedly. Each request has a total deadline; disposal
 * aborts the fetch for real. A 304 without a body-backed validator is
 * retried once unconditionally; failures keep lastGood at the caller.
 */

import type { CatalogFailureKind, FetchOutcome, FetchRequest } from "./catalog-contracts.js";

export const MAX_CATALOG_BODY_BYTES = 16 * 1024 * 1024;
const RETRY_AFTER_CAP_MS = 24 * 60 * 60 * 1000;

type GlobalFetch = typeof globalThis.fetch;

async function readBoundedBody(
	response: Response,
	request: FetchRequest,
	deadline: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; kind: CatalogFailureKind }> {
	const reader = response.body?.getReader();
	if (reader === undefined) return { ok: false, kind: "invalid" };
	const cancelReader = () => {
		void reader.cancel().catch(() => {});
	};
	deadline.addEventListener("abort", cancelReader, { once: true });
	const chunks: Uint8Array[] = [];
	let total = 0;
	const decoder = new TextDecoder();
	let readFailure: CatalogFailureKind | undefined;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_CATALOG_BODY_BYTES) {
				await reader.cancel().catch(() => {});
				return { ok: false, kind: "invalid" };
			}
			chunks.push(value);
		}
	} catch {
		await reader.cancel().catch(() => {});
		readFailure = "network";
	} finally {
		deadline.removeEventListener("abort", cancelReader);
	}
	if (request.signal.aborted) return { ok: false, kind: "disposed" };
	if (deadline.aborted) return { ok: false, kind: "timeout" };
	if (readFailure !== undefined) return { ok: false, kind: readFailure };
	let text = "";
	for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
	text += decoder.decode();
	return { ok: true, text };
}

function parseRetryAfterMs(response: Response, now: number): number | undefined {
	const header = response.headers.get("retry-after");
	if (header === null) return undefined;
	if (/^[0-9]+$/.test(header)) {
		const ms = Number(header) * 1000;
		return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS) : undefined;
	}
	const at = Date.parse(header);
	if (!Number.isFinite(at)) return undefined;
	return Math.min(Math.max(at - now, 0), RETRY_AFTER_CAP_MS);
}

async function once(
	fetcher: GlobalFetch,
	request: FetchRequest,
	sendValidator: boolean,
): Promise<FetchOutcome> {
	const controller = new AbortController();
	const deadline = setTimeout(() => controller.abort(), request.timeoutMs);
	try {
		const signal = AbortSignal.any([request.signal, controller.signal]);
		let response: Response;
		try {
			response = await fetcher(request.url, {
				method: "GET",
				redirect: "error",
				keepalive: false,
				headers: {
					accept: "application/json",
					...(sendValidator && request.etag !== undefined ? { "if-none-match": request.etag } : {}),
				},
				signal,
			});
		} catch {
			if (request.signal.aborted) return { outcome: "failed", kind: "disposed" };
			if (controller.signal.aborted) return { outcome: "failed", kind: "timeout" };
			return { outcome: "failed", kind: "network" };
		}
		return await respond(response, request, signal);
	} finally {
		clearTimeout(deadline);
	}
}

async function discardBody(response: Response): Promise<void> {
	await response.body?.cancel().catch(() => {});
}

async function respond(response: Response, request: FetchRequest, deadline: AbortSignal): Promise<FetchOutcome> {
	if (response.status === 304) {
		await discardBody(response);
		return { outcome: "unchanged" };
	}
	if (response.status === 404 || response.status === 501) {
		await discardBody(response);
		return { outcome: "no-data" };
	}
	if (response.status === 429) {
		const retryAfterMs = parseRetryAfterMs(response, Date.now());
		await discardBody(response);
		return { outcome: "failed", kind: "rate-limit", ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
	}
	if (!(response.status >= 200 && response.status <= 299)) {
		await discardBody(response);
		return { outcome: "failed", kind: "http" };
	}
	const body = await readBoundedBody(response, request, deadline);
	if (!body.ok) return { outcome: "failed", kind: body.kind };
	try {
		const etag = response.headers.get("etag");
		const lastModified = Date.parse(response.headers.get("last-modified") ?? "") || undefined;
		return {
			outcome: "updated",
			value: JSON.parse(body.text),
			...(etag === null ? {} : { etag }),
			...(lastModified === undefined ? {} : { lastModified }),
		};
	} catch {
		return { outcome: "failed", kind: "invalid" };
	}
}

export async function fetchOfficialCatalog(fetcher: GlobalFetch, request: FetchRequest): Promise<FetchOutcome> {
	const sendValidator = request.etag !== undefined;
	const first = await once(fetcher, request, sendValidator);
	if (first.outcome === "unchanged" && !sendValidator) {
		const second = await once(fetcher, request, false);
		if (second.outcome === "unchanged") return { outcome: "failed", kind: "http" };
		return second;
	}
	return first;
}
