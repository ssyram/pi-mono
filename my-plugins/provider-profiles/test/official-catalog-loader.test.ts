/**
 * Isolated real-install loader verification (docs/official-catalog-sync.md:
 * 全局extensions软链指工作树，严禁半成品startup回归). Loads the official-catalog
 * probe through the PRODUCTION dist loader (jiti + its real alias map) with
 * an isolated PI_CODING_AGENT_DIR, a synthetic pre-seeded private cache, and
 * no network access. Proves the module loads and composes through the same
 * import channels the installed extension uses, before and after wiring.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadExtensions } from "../../../packages/coding-agent/dist/core/extensions/loader.js";
import { probeOwner } from "./fixtures/catalog-loader-probe.js";
import { getBase } from "../provider-source.js";

const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";
const FAR_FUTURE = 4_102_444_800_000;

let previousAgentDir: string | undefined;
let isolated: string;

beforeEach(async () => {
	previousAgentDir = process.env[ENV_AGENT_DIR];
	isolated = await mkdtemp(join(tmpdir(), "pp-catalog-loader-"));
	process.env[ENV_AGENT_DIR] = isolated;
});

afterEach(async () => {
	probeOwner()?.dispose();
	if (previousAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
	else process.env[ENV_AGENT_DIR] = previousAgentDir;
	await rm(isolated, { force: true, recursive: true });
});

async function seedZaiCache(modelId: string): Promise<void> {
	const source = getBase("zai");
	const template = source.getModels()[0] as unknown as Record<string, unknown>;
	const cache = {
		version: 1,
		sourceId: "zai",
		apiSet: ["openai-completions"],
		baseUrl: source.baseUrl,
		models: [{ ...template, id: modelId, name: `Loader fixture ${modelId}`, headers: undefined }],
		checkedAt: Date.now(),
		retryAt: 0,
		lastModified: FAR_FUTURE,
		etag: undefined,
	};
	const path = join(isolated, "provider-profiles", "official-catalog", "zai.json");
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, JSON.stringify(cache), "utf8");
}

test("the real production loader composes the official-catalog module with a restored private cache", async () => {
	await seedZaiCache("glm-loader-fixture");
	const probePath = join(import.meta.dirname, "fixtures", "catalog-loader-probe.ts");
	const result = await loadExtensions([probePath], isolated);
	expect(result.errors).toEqual([]);
	const registration = result.runtime.pendingNativeProviderRegistrations[0];
	expect(registration).toBeDefined();
	const provider = registration?.provider;
	expect(provider?.id).toBe("zai-loader-probe");
	const models = provider?.getModels() ?? [];
	const ids = models.map((model) => model.id);
	expect(ids).toContain("glm-loader-fixture");
	for (const builtin of getBase("zai").getModels()) expect(ids).toContain(builtin.id);
	expect(models.every((model) => model.provider === "zai-loader-probe")).toBe(true);
	expect(provider?.refreshModels).toBeTypeOf("function");
	expect(provider?.auth).toBeDefined();
	expect(result.runtime.pendingNativeProviderRegistrations.length).toBe(1);
});

test("dispose falls back to the original catalog without breaking the instance", async () => {
	await seedZaiCache("glm-loader-fixture");
	const probePath = join(import.meta.dirname, "fixtures", "catalog-loader-probe.ts");
	const result = await loadExtensions([probePath], isolated);
	expect(result.errors).toEqual([]);
	const provider = result.runtime.pendingNativeProviderRegistrations[0]?.provider;
	expect(provider?.getModels().map((model) => model.id)).toContain("glm-loader-fixture");
	probeOwner()?.dispose();
	const afterDispose = provider?.getModels() ?? [];
	expect(afterDispose.map((model) => model.id)).not.toContain("glm-loader-fixture");
	for (const builtin of getBase("zai").getModels()) {
		expect(afterDispose.map((model) => model.id)).toContain(builtin.id);
	}
});

test("a fresh isolated agent dir (cache miss) still registers the unmodified instance", async () => {
	const probePath = join(import.meta.dirname, "fixtures", "catalog-loader-probe.ts");
	const result = await loadExtensions([probePath], isolated);
	expect(result.errors).toEqual([]);
	const provider = result.runtime.pendingNativeProviderRegistrations[0]?.provider;
	const ids = (provider?.getModels() ?? []).map((model) => model.id);
	expect(ids.length).toBe(getBase("zai").getModels().length);
	expect(ids).not.toContain("glm-loader-fixture");
});

test("the real wired extension loads through the production loader without startup regression", async () => {
	await mkdir(join(isolated, "provider-profiles", "official-catalog"), { recursive: true });
	const config = {
		"zai-live": { provider: "zai", apiKey: "synthetic-loader-key" },
		"cn-live": { provider: "zai-coding-cn" },
	};
	await writeFile(join(isolated, "provider-profiles.json"), JSON.stringify(config), "utf8");
	const pluginDir = join(import.meta.dirname, "..");
	const result = await loadExtensions([pluginDir], isolated);
	expect(result.errors).toEqual([]);
	expect(result.runtime.pendingNativeProviderRegistrations.map((entry) => entry.provider.id)).toEqual([
		"zai-live",
		"cn-live",
	]);
	const provider = result.runtime.pendingNativeProviderRegistrations[0]?.provider;
	expect(provider?.refreshModels).toBeTypeOf("function");
	for (const builtin of getBase("zai").getModels()) {
		expect(provider?.getModels().some((model) => model.id === builtin.id && model.provider === "zai-live")).toBe(true);
	}
});
