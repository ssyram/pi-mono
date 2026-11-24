/**
 * Minimal direct tests for the unwired official-catalog module
 * (docs/official-catalog-sync.md D1-D5, D7). These exercise the real product
 * functions with the real builtin zai source and synthetic catalog payloads —
 * fixture values only, never claimed real GLM metadata.
 */

import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { Provider } from "@earendil-works/pi-ai";
import { instanceProvider } from "../instantiator.js";
import { getBase } from "../provider-source.js";
import { readCatalogCache, writeCatalogCache } from "../official-catalog/catalog-cache.js";
import type { CacheV1, CatalogSource } from "../official-catalog/catalog-contracts.js";
import { fetchOfficialCatalog, MAX_CATALOG_BODY_BYTES } from "../official-catalog/catalog-fetch.js";
import { mergeOfficial } from "../official-catalog/catalog-merge.js";
import { parseCatalog } from "../official-catalog/catalog-parse.js";
import { catalogCachePath, resolveCatalogSource } from "../official-catalog/catalog-source.js";
import { readOverlayModel } from "../official-catalog/overlay-model.js";

const ZAI_ENDPOINT = "https://api.z.ai/api/coding/paas/v4";

function zaiInstance(name = "zai-fixture"): Provider {
	return instanceProvider(getBase("zai"), { name, provider: "zai" });
}

function overlayFixture(source: CatalogSource, id = "glm-fixture"): Record<string, unknown> {
	const base = getBase("zai").getModels()[0] as unknown as Record<string, unknown>;
	return { ...base, id, name: `Fixture ${id}`, provider: source.sourceId, baseUrl: source.endpoint };
}

test("resolveCatalogSource adapts the real zai instance with its verified endpoint and api set", () => {
	const source = resolveCatalogSource(zaiInstance(), "zai");
	expect(source).toBeDefined();
	expect(source?.catalogUrl).toBe("https://pi.dev/api/models/providers/zai?types=chat");
	expect(source?.endpoint).toBe(ZAI_ENDPOINT);
	expect(source?.apiSet).toEqual(["openai-completions"]);
});

test("resolveCatalogSource returns undefined for unknown sources without side effects", () => {
	expect(resolveCatalogSource(zaiInstance(), "not-a-source")).toBeUndefined();
	expect(resolveCatalogSource(zaiInstance(), "")).toBeUndefined();
});

test("readOverlayModel accepts a real-shaped catalog record and strips headers", () => {
	const source = resolveCatalogSource(zaiInstance(), "zai");
	expect(source).toBeDefined();
	const record = overlayFixture(source!);
	record.headers = { authorization: "synthetic" };
	const model = readOverlayModel(record, source!);
	expect(model?.id).toBe("glm-fixture");
	expect(model?.provider).toBe("zai");
	expect((model as unknown as Record<string, unknown>).headers).toBeUndefined();
	expect(model?.maxTokens).toBe(getBase("zai").getModels()[0].maxTokens);
});

test("readOverlayModel drops wrong-endpoint, wrong-provider, wrong-api, and bad-number records", () => {
	const source = resolveCatalogSource(zaiInstance(), "zai")!;
	for (const patch of [
		{ baseUrl: "https://evil.example/api" },
		{ provider: "other-source" },
		{ api: "anthropic-messages" },
		{ contextWindow: 0 },
		{ maxTokens: Number.POSITIVE_INFINITY },
		{ cost: { input: -1, output: 2, cacheRead: 0, cacheWrite: 0 } },
		{ thinkingLevelMap: { low: 3 } },
		{ input: ["image"] },
	]) {
		expect(readOverlayModel({ ...overlayFixture(source), ...patch }, source)).toBeUndefined();
	}
});

test("parseCatalog accepts the three official wire shapes and rejects arbitrary objects", () => {
	const source = resolveCatalogSource(zaiInstance(), "zai")!;
	const fixture = overlayFixture(source);
	expect(parseCatalog([fixture], source)).toEqual({ type: "valid", models: [expect.anything()] });
	expect(parseCatalog({ models: [fixture] }, source)).toEqual({ type: "valid", models: [expect.anything()] });
	expect(parseCatalog({ "glm-fixture": fixture }, source)).toEqual({ type: "valid", models: [expect.anything()] });
	expect(parseCatalog({ error: "internal" }, source)).toEqual({ type: "invalid" });
	expect(parseCatalog("nope", source)).toEqual({ type: "invalid" });
	expect(parseCatalog([fixture, { garbage: true }], source)).toEqual({ type: "valid", models: [expect.anything()] });
	expect(parseCatalog({ a: fixture, b: "garbage" }, source)).toEqual({ type: "invalid" });
});

test("mergeOfficial overrides same type/id, keeps original models, restamps, and mutates nothing", () => {
	const source = resolveCatalogSource(zaiInstance("zai-merge"), "zai")!;
	const instance = zaiInstance("zai-merge");
	const original = instance.getModels();
	const overlayModel = readOverlayModel(overlayFixture(source, original[0].id), source)!;
	const merged = mergeOfficial(original, [overlayModel], "zai-merge");
	expect(merged.every((model) => model.provider === "zai-merge")).toBe(true);
	const overridden = merged.find((model) => model.id === overlayModel.id);
	expect(overridden?.name).toBe(overlayModel.name);
	expect(merged.length).toBe(new Set(merged.map((model) => `${model.type ?? "chat"}\0${model.id}`)).size);
	const again = mergeOfficial(merged, [overlayModel], "zai-merge");
	expect(again.map((model) => [model.id, model.name])).toEqual(merged.map((model) => [model.id, model.name]));
	expect(original[0].provider).toBe("zai-merge");
	expect(instance.getModels().length).toBe(original.length);
});

test("cache write/read roundtrip is exact and mismatched fingerprints are misses", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pp-catalog-unit-"));
	try {
		const source = resolveCatalogSource(zaiInstance(), "zai")!;
		const path = catalogCachePath(dir, "zai");
		const models = [readOverlayModel(overlayFixture(source), source)!];
		const cache: CacheV1 = {
			version: 1,
			sourceId: "zai",
			apiSet: ["openai-completions"],
			baseUrl: source.endpoint,
			models,
			checkedAt: 1234,
			retryAt: 0,
			lastModified: 5678,
			etag: "\"synthetic-etag\"",
		};
		expect((await writeCatalogCache(path, cache, new AbortController().signal)).type).toBe("written");
		const read = await readCatalogCache(path, source);
		expect(read.type).toBe("hit");
		if (read.type === "hit") {
			expect(read.cache.models.map((model) => model.id)).toEqual(["glm-fixture"]);
			expect(read.cache.etag).toBe("\"synthetic-etag\"");
			expect(read.cache.checkedAt).toBe(1234);
		}
		const moved: CatalogSource = { ...source, endpoint: "https://moved.example/v4" };
		expect(await readCatalogCache(path, moved)).toEqual({ type: "miss", reason: "mismatch" });
		await writeFile(path, "{not json", "utf8");
		expect(await readCatalogCache(path, source)).toEqual({ type: "miss", reason: "invalid" });
		await rm(path, { force: true });
		expect(await readCatalogCache(path, source)).toEqual({ type: "miss", reason: "missing" });
		const listing = await readFile(join(path), "utf8").catch(() => "");
		expect(listing).toBe("");
	} finally {
		await rm(dir, { force: true, recursive: true });
	}
});

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	const text = body === null ? null : typeof body === "string" ? body : JSON.stringify(body);
	return new Response(text, { status, headers });
}

function fetchWith(
	responses: Response[],
	requests: { url: string; headers: Record<string, string> }[],
): typeof globalThis.fetch {
	let call = 0;
	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const headers = (init?.headers ?? {}) as Record<string, string>;
		requests.push({ url, headers });
		return responses[call++] ?? response(500, {});
	};
}

test("a bodiless 2xx response is invalid without falling back to an unbounded text() read", async () => {
	const bodiless = fetchWith([new Response(null, { status: 200, headers: { etag: "\"v0\"" } })], []);
	const outcome = await fetchOfficialCatalog(bodiless, {
		url: "https://catalog.example/zai",
		timeoutMs: 1000,
		signal: new AbortController().signal,
	});
	expect(outcome).toEqual({ outcome: "failed", kind: "invalid" });
});

test("chunked valid JSON bodies are reassembled and parsed", async () => {
	const bytes = new TextEncoder().encode(JSON.stringify({ models: [] }));
	const half = Math.ceil(bytes.length / 2);
	const chunked = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes.subarray(0, half));
			controller.enqueue(bytes.subarray(half));
			controller.close();
		},
	});
	const outcome = await fetchOfficialCatalog(
		async () => new Response(chunked, { status: 200, headers: { etag: "\"chunked\"" } }),
		{ url: "https://catalog.example/zai", timeoutMs: 1000, signal: new AbortController().signal },
	);
	expect(outcome).toEqual({ outcome: "updated", value: { models: [] }, etag: "\"chunked\"" });
});

test("a stalled body times out within the deadline, is classified timeout, and its stream is cancelled", async () => {
	let cancelReason: string | undefined;
	const stalled = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('{"partial":'));
		},
		cancel(reason) {
			cancelReason = typeof reason === "string" ? reason : "cancelled";
		},
	});
	const startedAt = Date.now();
	const outcome = await fetchOfficialCatalog(async () => new Response(stalled, { status: 200 }), {
		url: "https://catalog.example/zai",
		timeoutMs: 150,
		signal: new AbortController().signal,
	});
	expect(outcome).toEqual({ outcome: "failed", kind: "timeout" });
	expect(Date.now() - startedAt).toBeLessThan(5_000);
	await vi.waitFor(() => expect(cancelReason).toBeDefined());
});

test("external abort during body consumption reports disposed and cancels the stream", async () => {
	let cancelled = false;
	const controller = new AbortController();
	const stalled = new ReadableStream<Uint8Array>({
		start(stream) {
			stream.enqueue(new TextEncoder().encode('{"partial":'));
		},
		cancel() {
			cancelled = true;
		},
	});
	const pending = fetchOfficialCatalog(async () => new Response(stalled, { status: 200 }), {
		url: "https://catalog.example/zai",
		timeoutMs: 10_000,
		signal: controller.signal,
	});
	await new Promise((resolve) => setTimeout(resolve, 25));
	controller.abort();
	expect(await pending).toEqual({ outcome: "failed", kind: "disposed" });
	expect(cancelled).toBe(true);
});

test("real local HTTP with a never-ending body times out and tears down the connection", async () => {
	const sockets = new Set<Socket>();
	const server = createServer((_request, serverResponse) => {
		serverResponse.writeHead(200, { "content-type": "application/json", etag: "\"v1\"" });
		serverResponse.write('{"partial":');
	});
	server.on("connection", (socket) => sockets.add(socket));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	try {
		const startedAt = Date.now();
		const outcome = await fetchOfficialCatalog(globalThis.fetch, {
			url: `http://127.0.0.1:${port}/catalog`,
			timeoutMs: 150,
			signal: new AbortController().signal,
		});
		expect(outcome).toEqual({ outcome: "failed", kind: "timeout" });
		expect(Date.now() - startedAt).toBeLessThan(5_000);
		await vi.waitFor(() => {
			for (const socket of sockets) expect(socket.destroyed).toBe(true);
		});
	} finally {
		for (const socket of sockets) socket.destroy();
		server.close();
	}
});

test("a body of exactly 16 MiB parses while one byte over the cap is invalid and cancelled", async () => {
	const signal = new AbortController().signal;
	const exact = `"${"a".repeat(MAX_CATALOG_BODY_BYTES - 2)}"`;
	expect(exact.length).toBe(MAX_CATALOG_BODY_BYTES);
	const atCap = await fetchOfficialCatalog(fetchWith([new Response(exact, { status: 200 })], []), {
		url: "https://catalog.example/zai",
		timeoutMs: 10_000,
		signal,
	});
	expect(atCap).toMatchObject({ outcome: "updated", value: exact.slice(1, -1) });

	let cancelled = false;
	const chunk = new TextEncoder().encode("b".repeat(64 * 1024));
	const over = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let sent = 0; sent <= MAX_CATALOG_BODY_BYTES; sent += chunk.byteLength) {
				controller.enqueue(chunk.subarray(0, Math.min(chunk.byteLength, MAX_CATALOG_BODY_BYTES + 1 - sent)));
			}
		},
		cancel() {
			cancelled = true;
		},
	});
	const overCap = await fetchOfficialCatalog(async () => new Response(over, { status: 200 }), {
		url: "https://catalog.example/zai",
		timeoutMs: 10_000,
		signal,
	});
	expect(overCap).toEqual({ outcome: "failed", kind: "invalid" });
	expect(cancelled).toBe(true);
});

test("fetchOfficialCatalog maps statuses, honors etag validators, and refetches a bodiless 304 once", async () => {
	const requests: { url: string; headers: Record<string, string> }[] = [];
	const signal = new AbortController().signal;

	const ok = fetchWith([response(200, { any: 1 }, { etag: "\"v1\"", "last-modified": "Thu, 01 Jan 2099 00:00:00 GMT" })], requests);
	let outcome = await fetchOfficialCatalog(ok, { url: "https://catalog.example/zai", timeoutMs: 1000, signal });
	expect(outcome).toMatchObject({ outcome: "updated", etag: "\"v1\"" });
	expect(requests[0]?.headers).toEqual({ accept: "application/json" });

	requests.length = 0;
	const notModified = fetchWith([response(304, null)], requests);
	outcome = await fetchOfficialCatalog(notModified, {
		url: "https://catalog.example/zai",
		etag: "\"v1\"",
		timeoutMs: 1000,
		signal,
	});
	expect(outcome).toEqual({ outcome: "unchanged" });
	expect(requests[0]?.headers["if-none-match"]).toBe("\"v1\"");

	requests.length = 0;
	const stray304 = fetchWith([response(304, null), response(200, [{}])], requests);
	outcome = await fetchOfficialCatalog(stray304, { url: "https://catalog.example/zai", timeoutMs: 1000, signal });
	expect(outcome).toMatchObject({ outcome: "updated" });
	expect(requests.length).toBe(2);
	expect(requests.every((request) => request.headers["if-none-match"] === undefined)).toBe(true);

	requests.length = 0;
	const double304 = fetchWith([response(304, null), response(304, null)], requests);
	outcome = await fetchOfficialCatalog(double304, { url: "https://catalog.example/zai", timeoutMs: 1000, signal });
	expect(outcome).toEqual({ outcome: "failed", kind: "http" });

	for (const [status, kind] of [
		[404, "no-data"],
		[501, "no-data"],
		[401, "http"],
		[500, "http"],
	] as const) {
		outcome = await fetchOfficialCatalog(fetchWith([response(status, {})], []), {
			url: "https://catalog.example/zai",
			timeoutMs: 1000,
			signal,
		});
		expect(outcome).toEqual(status === 404 || status === 501 ? { outcome: "no-data" } : { outcome: "failed", kind });
	}

	requests.length = 0;
	const limited = fetchWith(
		[response(429, {}, { "retry-after": "30" })],
		requests,
	);
	outcome = await fetchOfficialCatalog(limited, { url: "https://catalog.example/zai", timeoutMs: 1000, signal });
	expect(outcome).toEqual({ outcome: "failed", kind: "rate-limit", retryAfterMs: 30_000 });
});
