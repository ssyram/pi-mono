/**
 * Refresh lifecycle (docs/official-catalog-sync.md D7/D8/D10): cache-only
 * publish, TTL/force/retryAt gating, single-flight, 304/404/429/5xx/invalid
 * handling, private-cache commit ordering, dispose and late-job safety,
 * warning episodes, and original-refresh delegation. Fake clock and fake
 * fetch only — no real network. Background jobs finish with real fs I/O, so
 * every result cluster polls real observables (private-cache commit via
 * readCatalogCache, or emitted warnings) with vi.waitFor; a fixed setImmediate
 * count is never the completion guarantee, and no product test hook exists.
 */

import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import { instanceProvider } from "../instantiator.js";
import { createCatalogOwner, type CatalogHooks, type CatalogOwner } from "../official-catalog/catalog-owner.js";
import { readCatalogCache } from "../official-catalog/catalog-cache.js";
import { catalogCachePath, resolveCatalogSource } from "../official-catalog/catalog-source.js";
import type { CacheRead, CatalogSource } from "../official-catalog/catalog-contracts.js";
import { SUCCESS_TTL_MS } from "../official-catalog/catalog-refresh.js";
import { getBase } from "../provider-source.js";

const FAR_FUTURE = 4_102_444_800_000;

let agentDir: string;
let clock: number;
const fetchLog: { url: string; headers: Record<string, string> }[] = [];
const notifications: { message: string; level: string }[] = [];
const updatedIds: string[][] = [];
const unhandled: unknown[] = [];
let respondWith: () => Response;
let cacheProbe: CatalogSource | undefined;

function catalogResponse(models: Record<string, unknown>[], headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(models), {
		status: 200,
		headers: { "last-modified": new Date(FAR_FUTURE).toUTCString(), ...headers },
	});
}

function fixtureModel(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
	const template = getBase("zai").getModels()[0] as unknown as Record<string, unknown>;
	return { ...template, id, name: `Fixture ${id}`, ...patch };
}

function zaiInstance(name: string): Provider {
	return instanceProvider(getBase("zai"), { name, provider: "zai" });
}

function ownerWith(response: () => Response): CatalogOwner {
	respondWith = response;
	return createCatalogOwner(agentDir, {
		fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
			fetchLog.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
			return respondWith();
		},
		now: () => clock,
		generatedAt: () => 0,
	});
}

function hooks(): CatalogHooks {
	return {
		notify: (message, level) => notifications.push({ message, level }),
		onUpdated: async (ids) => {
			updatedIds.push([...ids]);
		},
	};
}

function context(overrides: { allowNetwork?: boolean; force?: boolean } = {}): RefreshModelsContext {
	const publications: { persist?: unknown; update?: unknown }[] = [];
	const controller = new AbortController();
	const context: RefreshModelsContext = {
		publish: async (publication) => {
			publications.push(publication);
			return true;
		},
		allowNetwork: overrides.allowNetwork ?? false,
		force: overrides.force,
		signal: controller.signal,
	};
	(context as { publications?: unknown }).publications = publications;
	return context;
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

function publicationsOf(refreshContext: RefreshModelsContext): { persist?: unknown; update?: unknown }[] {
	return (refreshContext as { publications?: { persist?: unknown; update?: unknown }[] }).publications ?? [];
}

function probeSource(): CatalogSource {
	if (cacheProbe === undefined) {
		const resolved = resolveCatalogSource(zaiInstance("zai-cache-probe"), "zai");
		if (resolved === undefined) throw new Error("zai catalog source failed to resolve for cache polling");
		cacheProbe = resolved;
	}
	return cacheProbe;
}

function readPrivateCache(): Promise<CacheRead> {
	return readCatalogCache(catalogCachePath(agentDir, "zai"), probeSource());
}

/** Bounded poll on the real private-cache file: proves this job's commit
 * (checkedAt written under the fake clock at fetch time) landed on disk. */
async function waitForCache(committed: (read: CacheRead) => boolean): Promise<void> {
	await vi.waitFor(async () => {
		expect(committed(await readPrivateCache()), "private cache commit").toBe(true);
	});
}

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "pp-catalog-refresh-"));
	clock = 1_000_000;
	fetchLog.length = 0;
	notifications.length = 0;
	updatedIds.length = 0;
	unhandled.length = 0;
	cacheProbe = undefined;
	process.on("unhandledRejection", recordUnhandled);
});

afterEach(async () => {
	process.off("unhandledRejection", recordUnhandled);
	expect(unhandled).toEqual([]);
	vi.restoreAllMocks();
	await rm(agentDir, { force: true, recursive: true });
});

function recordUnhandled(reason: unknown): void {
	unhandled.push(reason);
}

test("cache-only refresh publishes update-only and never fetches", async () => {
	const owner = ownerWith(() => new Response("{}", { status: 500 }));
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	const cacheContext = context({ allowNetwork: false });
	await provider.refreshModels?.(cacheContext);
	expect(publicationsOf(cacheContext).every((entry) => entry.persist === undefined)).toBe(true);
	expect(fetchLog).toEqual([]);
});

test("network refresh after cache miss fetches, applies the newer catalog, syncs instances, and persists privately", async () => {
	const owner = ownerWith(() => catalogResponse([fixtureModel("glm-5.4-fixture")], { etag: "\"v1\"" }));
	owner.attach(hooks());
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	expect(provider.getModels().map((model) => model.id)).not.toContain("glm-5.4-fixture");
	const checkedAt = clock;
	const network = context({ allowNetwork: true, force: true });
	await provider.refreshModels?.(network);
	await waitForCache(
		(read) =>
			read.type === "hit" &&
			read.cache.checkedAt === checkedAt &&
			read.cache.models.some((model) => model.id === "glm-5.4-fixture"),
	);
	await vi.waitFor(() => {
		expect(fetchLog.length).toBe(1);
		expect(fetchLog[0]?.headers["if-none-match"]).toBeUndefined();
		expect(provider.getModels().map((model) => model.id)).toContain("glm-5.4-fixture");
		expect(updatedIds).toEqual([["zai-live"]]);
		expect(notifications).toEqual([]);
	});
});

test("TTL gates non-forced refresh; force bypasses TTL; retryAt backoff blocks even force", async () => {
	let status = 500;
	const owner = ownerWith(() => new Response("{}", { status }));
	owner.attach(hooks());
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	await vi.waitFor(() => expect(notifications.filter((entry) => entry.message.includes("(http)")).length).toBe(1));
	clock += 1000;
	await provider.refreshModels?.(context({ allowNetwork: true }));
	expect(fetchLog.length).toBe(1);
	status = 429;
	clock += SUCCESS_TTL_MS + 1;
	await provider.refreshModels?.(context({ allowNetwork: true }));
	await vi.waitFor(() =>
		expect(notifications.filter((entry) => entry.message.includes("(rate-limit)")).length).toBe(1),
	);
	clock += 59_999;
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	expect(fetchLog.length).toBe(2);
	clock += 1;
	await provider.refreshModels?.(context({ allowNetwork: true }));
	await vi.waitFor(() => expect(fetchLog.length).toBe(3));
	await settle();
	await vi.waitFor(() => {
		expect(notifications.length).toBe(2);
		expect(notifications[0]?.message).toContain("(http)");
		expect(notifications[1]?.message).toContain("(rate-limit)");
		expect(notifications.every((entry) => entry.level === "warning")).toBe(true);
	});
});

test("single-flight: concurrent refreshes of one source fetch once and update every instance", async () => {
	const owner = ownerWith(() => catalogResponse([fixtureModel("glm-shared-fixture")]));
	owner.attach(hooks());
	const one = await owner.compose(zaiInstance("acc-one"), "zai");
	const two = await owner.compose(zaiInstance("acc-two"), "zai");
	const checkedAt = clock;
	await Promise.all([
		one.refreshModels?.(context({ allowNetwork: true, force: true })),
		two.refreshModels?.(context({ allowNetwork: true, force: true })),
	]);
	await waitForCache(
		(read) =>
			read.type === "hit" &&
			read.cache.checkedAt === checkedAt &&
			read.cache.models.some((model) => model.id === "glm-shared-fixture"),
	);
	await vi.waitFor(() => {
		expect(fetchLog.length).toBe(1);
		for (const provider of [one, two]) {
			expect(provider.getModels().map((model) => model.id)).toContain("glm-shared-fixture");
		}
		expect(updatedIds).toEqual([["acc-one", "acc-two"]]);
	});
});

test("304 keeps lastGood, resets the TTL window, and rewrites the private cache", async () => {
	const owner = ownerWith(() => catalogResponse([fixtureModel("glm-5.4-fixture")], { etag: "\"v1\"" }));
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	const firstCheck = clock;
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	await waitForCache(
		(read) =>
			read.type === "hit" &&
			read.cache.checkedAt === firstCheck &&
			read.cache.models.some((model) => model.id === "glm-5.4-fixture"),
	);
	await vi.waitFor(() => expect(provider.getModels().map((model) => model.id)).toContain("glm-5.4-fixture"));
	respondWith = () => new Response(null, { status: 304 });
	clock += SUCCESS_TTL_MS + 1;
	const secondCheck = clock;
	await provider.refreshModels?.(context({ allowNetwork: true }));
	await waitForCache(
		(read) =>
			read.type === "hit" &&
			read.cache.checkedAt === secondCheck &&
			read.cache.etag === "\"v1\"" &&
			read.cache.lastModified === FAR_FUTURE &&
			read.cache.models.some((model) => model.id === "glm-5.4-fixture"),
	);
	await vi.waitFor(() => {
		expect(fetchLog.length).toBe(2);
		expect(fetchLog[1]?.headers["if-none-match"]).toBe("\"v1\"");
		expect(provider.getModels().map((model) => model.id)).toContain("glm-5.4-fixture");
		expect(notifications).toEqual([]);
	});
	clock += 1000;
	await provider.refreshModels?.(context({ allowNetwork: true }));
	expect(fetchLog.length).toBe(2);
});

test("404 keeps the models, is not an error, and the restart does not restore the overlay", async () => {
	const owner = ownerWith(() => catalogResponse([fixtureModel("glm-404-fixture")]));
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	const firstCheck = clock;
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	await waitForCache(
		(read) =>
			read.type === "hit" &&
			read.cache.checkedAt === firstCheck &&
			read.cache.models.some((model) => model.id === "glm-404-fixture"),
	);
	await vi.waitFor(() => expect(provider.getModels().map((model) => model.id)).toContain("glm-404-fixture"));
	respondWith = () => new Response("gone", { status: 404 });
	clock += SUCCESS_TTL_MS + 1;
	const secondCheck = clock;
	await provider.refreshModels?.(context({ allowNetwork: true }));
	await waitForCache(
		(read) =>
			read.type === "hit" &&
			read.cache.checkedAt === secondCheck &&
			read.cache.lastModified === 0 &&
			read.cache.models.some((model) => model.id === "glm-404-fixture"),
	);
	await vi.waitFor(() => {
		expect(provider.getModels().map((model) => model.id)).toContain("glm-404-fixture");
		expect(notifications).toEqual([]);
	});
	owner.dispose();
	const restarted = ownerWith(() => new Response("{}", { status: 500 }));
	const restored = await restarted.compose(zaiInstance("zai-live"), "zai");
	expect(restored.getModels().map((model) => model.id)).not.toContain("glm-404-fixture");
});

test("invalid catalog bodies keep lastGood, warn once per episode, and resolve on recovery", async () => {
	let body = "not-json{";
	const owner = ownerWith(() =>
		new Response(body, { status: 200, headers: { "last-modified": new Date(FAR_FUTURE).toUTCString() } }),
	);
	owner.attach(hooks());
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	await vi.waitFor(() => {
		expect(provider.getModels().some((model) => model.id === "glm-5.4-fixture")).toBe(false);
		expect(notifications.length).toBe(1);
	});
	body = JSON.stringify([fixtureModel("glm-5.4-fixture")]);
	clock += SUCCESS_TTL_MS + 1;
	await provider.refreshModels?.(context({ allowNetwork: true }));
	await settle();
	await vi.waitFor(() =>
		expect(provider.getModels().map((model) => model.id), `fetchLog=${fetchLog.length}`).toContain("glm-5.4-fixture"),
	);
	expect(provider.getModels().map((model) => model.id)).toContain("glm-5.4-fixture");
	body = "again-broken";
	clock += SUCCESS_TTL_MS + 1;
	await provider.refreshModels?.(context({ allowNetwork: true }));
	await vi.waitFor(() => {
		expect(notifications.length).toBe(2);
		expect(notifications.every((entry) => entry.level === "warning")).toBe(true);
	});
});

test("cache write failure keeps the previous catalog and warns", async () => {
	const owner = ownerWith(() => catalogResponse([fixtureModel("glm-write-fixture")]));
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	const firstCheck = clock;
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	await waitForCache(
		(read) =>
			read.type === "hit" &&
			read.cache.checkedAt === firstCheck &&
			read.cache.models.some((model) => model.id === "glm-write-fixture"),
	);
	await vi.waitFor(() => expect(provider.getModels().map((model) => model.id)).toContain("glm-write-fixture"));
	owner.dispose();
	owner.attach(hooks());
	await chmod(join(agentDir, "provider-profiles", "official-catalog"), 0o500);
	const second = ownerWith(() => catalogResponse([fixtureModel("glm-write-fixture-2")]));
	second.attach(hooks());
	const provider2 = await second.compose(zaiInstance("zai-live"), "zai");
	expect(provider2.getModels().map((model) => model.id)).toContain("glm-write-fixture");
	await provider2.refreshModels?.(context({ allowNetwork: true, force: true }));
	await vi.waitFor(() => {
		expect(notifications.some((entry) => entry.message.includes("private cache"))).toBe(true);
		expect(provider2.getModels().map((model) => model.id)).toContain("glm-write-fixture");
		expect(provider2.getModels().map((model) => model.id)).not.toContain("glm-write-fixture-2");
	});
	await chmod(join(agentDir, "provider-profiles", "official-catalog"), 0o700);
});

test("dispose aborts jobs, falls back to the original catalog, and repeated dispose is a no-op", async () => {
	let releaseFetch: ((response: Response) => void) | undefined;
	const owner = createCatalogOwner(agentDir, {
		fetch: () =>
			new Promise<Response>((resolve) => {
				releaseFetch = resolve;
			}),
		now: () => clock,
		generatedAt: () => 0,
	});
	owner.attach(hooks());
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	void provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	await settle();
	expect(releaseFetch).toBeTypeOf("function");
	owner.dispose();
	owner.dispose();
	releaseFetch?.(catalogResponse([fixtureModel("glm-late-fixture")]));
	await settle();
	expect(provider.getModels().map((model) => model.id)).not.toContain("glm-late-fixture");
	expect(updatedIds).toEqual([]);
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	expect(fetchLog.length).toBe(0);
});

test("registry sync rejection warns once and never throws", async () => {
	const owner = ownerWith(() => catalogResponse([fixtureModel("glm-sync-fixture")]));
	owner.attach({
		notify: (message, level) => notifications.push({ message, level }),
		onUpdated: async () => {
			throw new Error("registry rejected");
		},
	});
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	await settle();
	await vi.waitFor(() =>
		expect(provider.getModels().map((model) => model.id), `fetchLog=${fetchLog.length}`).toContain("glm-sync-fixture"),
	);
	expect(provider.getModels().map((model) => model.id)).toContain("glm-sync-fixture");
	await vi.waitFor(() =>
		expect(
			notifications.some((entry) => entry.message.includes("snapshot sync")),
			`fetchLog=${fetchLog.length}`,
		).toBe(true),
	);
	expect(notifications.some((entry) => entry.message.includes("snapshot sync"))).toBe(true);
});

test("an original refreshModels is delegated first and its failure propagates unchanged", async () => {
	const calls: string[] = [];
	const base = getBase("zai");
	const original: Provider = {
		...instanceProvider(base, { name: "zai-delegate", provider: "zai" }),
		refreshModels: async (refreshContext: RefreshModelsContext) => {
			calls.push("original");
			if (refreshContext.allowNetwork) throw new Error("original refresh failed");
		},
	};
	const owner = ownerWith(() => catalogResponse([fixtureModel("glm-delegate-fixture")]));
	const composed = await owner.compose(original, "zai");
	await composed.refreshModels?.(context({ allowNetwork: false }));
	expect(calls).toEqual(["original"]);
	await expect(composed.refreshModels?.(context({ allowNetwork: true, force: true }))).rejects.toThrow(
		"original refresh failed",
	);
	await settle();
	expect(fetchLog.length).toBe(0);
});

test("attach after dispose cannot revive background jobs or emit updates", async () => {
	const owner = ownerWith(() => catalogResponse([fixtureModel("glm-revive-fixture")]));
	const provider = await owner.compose(zaiInstance("zai-live"), "zai");
	owner.dispose();
	owner.attach(hooks());
	clock += SUCCESS_TTL_MS + 1;
	await provider.refreshModels?.(context({ allowNetwork: true, force: true }));
	await settle();
	expect(fetchLog.length).toBe(0);
	expect(updatedIds).toEqual([]);
	expect(notifications).toEqual([]);
});
