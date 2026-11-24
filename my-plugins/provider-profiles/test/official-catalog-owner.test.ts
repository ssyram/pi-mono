/**
 * Owner composition integration (docs/official-catalog-sync.md P/M, D6, D9):
 * startup restore, restart recovery, cache-miss startup, identity
 * preservation, official-update priority, and the explicit disable switch.
 * All clocks/fetch/generatedAt are injected; no real network is touched.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Provider } from "@earendil-works/pi-ai";
import { instanceProvider } from "../instantiator.js";
import { createCatalogOwner, type CatalogOwner } from "../official-catalog/catalog-owner.js";
import { readCatalogCache } from "../official-catalog/catalog-cache.js";
import { catalogCachePath, resolveCatalogSource } from "../official-catalog/catalog-source.js";
import { getBase } from "../provider-source.js";

const FAR_FUTURE = 4_102_444_800_000;

let agentDir: string;
let clock: number;
const fetchCalls: string[] = [];

function zaiInstance(name: string): Provider {
	return instanceProvider(getBase("zai"), { name, provider: "zai" });
}

function owner(overrides: { fetch?: typeof globalThis.fetch } = {}): CatalogOwner {
	return createCatalogOwner(agentDir, {
		fetch: overrides.fetch ?? (async () => {
			fetchCalls.push("unexpected");
			return new Response("{}", { status: 500 });
		}),
		now: () => clock,
		generatedAt: () => 0,
	});
}

async function seedCache(modelId: string, patch: Record<string, unknown> = {}): Promise<void> {
	const template = getBase("zai").getModels()[0] as unknown as Record<string, unknown>;
	const cache = {
		version: 1,
		sourceId: "zai",
		apiSet: ["openai-completions"],
		baseUrl: getBase("zai").baseUrl,
		models: [{ ...template, id: modelId, name: `Fixture ${modelId}` }],
		checkedAt: clock,
		retryAt: 0,
		lastModified: FAR_FUTURE,
		...patch,
	};
	const path = catalogCachePath(agentDir, "zai");
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, JSON.stringify(cache), "utf8");
}

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "pp-catalog-owner-"));
	clock = 1_000_000;
	fetchCalls.length = 0;
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(agentDir, { force: true, recursive: true });
});

test("startup restore: valid newer cache overlays the original catalog and preserves instance identity", async () => {
	await seedCache("glm-5.4-fixture");
	const original = zaiInstance("zai-live");
	const composed = await owner().compose(original, "zai");
	expect(composed).not.toBe(original);
	const ids = composed.getModels().map((model) => model.id);
	expect(ids).toContain("glm-5.4-fixture");
	for (const builtin of getBase("zai").getModels()) expect(ids).toContain(builtin.id);
	expect(composed.getModels().every((model) => model.provider === "zai-live")).toBe(true);
	expect(composed.id).toBe(original.id);
	expect(composed.name).toBe(original.name);
	expect(composed.baseUrl).toBe(original.baseUrl);
	expect(composed.headers).toBe(original.headers);
	expect(composed.auth).toBe(original.auth);
	expect(composed.stream).toBe(original.stream);
	expect(composed.streamSimple).toBe(original.streamSimple);
	expect(composed.filterModels).toBe(original.filterModels);
	expect(fetchCalls).toEqual([]);
});

test("older-than-bundled cache is not applied but stays readable for later refresh", async () => {
	await seedCache("glm-stale-fixture", { lastModified: 0 });
	const composed = await owner().compose(zaiInstance("zai-live"), "zai");
	expect(composed.getModels().map((model) => model.id)).not.toContain("glm-stale-fixture");
	const read = await readCatalogCache(catalogCachePath(agentDir, "zai"), resolveCatalogSource(zaiInstance("x"), "zai")!);
	expect(read.type).toBe("hit");
});

test("official update wins over the original same-id model without touching the base catalog", async () => {
	await seedCache("glm-5.4-fixture");
	const original = zaiInstance("zai-live");
	const template = getBase("zai").getModels()[0];
	await seedCache(template.id, {});
	const composed = await owner().compose(original, "zai");
	const merged = composed.getModels().find((model) => model.id === template.id);
	expect(merged?.provider).toBe("zai-live");
	const baseStill = getBase("zai").getModels().find((model) => model.id === template.id);
	expect(baseStill?.provider).toBe("zai");
	expect(original.getModels().every((model) => model.provider === "zai-live")).toBe(true);
});

test("cache miss composes the unmodified instance and never fetches during startup", async () => {
	const original = zaiInstance("zai-live");
	const composed = await owner().compose(original, "zai");
	expect(composed.getModels().length).toBe(original.getModels().length);
	expect(fetchCalls).toEqual([]);
});

test("PI_PROFILE_CATALOG_SYNC=0 disables composition and returns the identical instance object", async () => {
	await seedCache("glm-5.4-fixture");
	process.env.PI_PROFILE_CATALOG_SYNC = "0";
	try {
		const original = zaiInstance("zai-live");
		expect(await owner().compose(original, "zai")).toBe(original);
	} finally {
		delete process.env.PI_PROFILE_CATALOG_SYNC;
	}
});

test("unadapted sources (empty catalog or unknown id) keep the original object", async () => {
	const empty: Provider = {
		...zaiInstance("zai-live"),
		getModels: () => [],
	};
	expect(await owner().compose(empty, "zai")).toBe(empty);
	const unknown = zaiInstance("zai-live");
	expect(await owner().compose(unknown, "not-a-source")).toBe(unknown);
});

test("dispose during a pending cache read makes the in-flight compose return the original instance", async () => {
	await seedCache("glm-5.4-fixture");
	const closing = owner();
	const original = zaiInstance("zai-live");
	const pending = closing.compose(original, "zai");
	closing.dispose();
	expect(await pending).toBe(original);
	const afterClose = zaiInstance("zai-live");
	expect(await closing.compose(afterClose, "zai")).toBe(afterClose);
	expect(fetchCalls).toEqual([]);
});

test("compose and attach after dispose are sticky no-ops that never wrap, revive, or fetch", async () => {
	await seedCache("glm-5.4-fixture");
	const dead = owner();
	dead.dispose();
	const original = zaiInstance("zai-live");
	expect(await dead.compose(original, "zai")).toBe(original);
	dead.attach({
		notify: () => fetchCalls.push("attach"),
		onUpdated: async () => fetchCalls.push("revived"),
	});
	dead.dispose();
	const again = zaiInstance("zai-live");
	expect(await dead.compose(again, "zai")).toBe(again);
	expect(again.getModels().map((model) => model.id)).toEqual(original.getModels().map((model) => model.id));
	expect(fetchCalls).toEqual([]);
});
