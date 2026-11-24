import { describe, expect, it } from "vitest";
import { officialMetadataProvider, findMetadataProvider, bindModel, createMetadataIndex, createModelCatalog, fetchModelIds } from "../src/model-catalog.js";
import type { Model, Provider, RefreshModelsContext } from "@earendil-works/pi-ai";

function fakeMetadata(): { provider: Provider; models: Model[] } {
	const models: Model[] = [
		{ id: "glm-5.3", name: "GLM 5.3", provider: "zai-coding-cn", api: "openai-completions", reasoning: true, input: ["text"], contextWindow: 1000, maxTokens: 100 } as Model,
		{ id: "glm-4.6", name: "GLM 4.6", provider: "zai-coding-cn", api: "openai-completions", reasoning: false, input: ["text"], contextWindow: 2000, maxTokens: 200 } as Model,
	];
	return { models, provider: { id: "zai-coding-cn", name: "test", auth: {} as Provider["auth"], getModels: () => models } as Provider };
}

describe("metadata index", () => {
	it("uses the installed official provider and exposes glm-5.3", () => {
		const provider = officialMetadataProvider();
		const index = createMetadataIndex(provider);
		expect(index.has("glm-5.3")).toBe(true);
	});

	it("throws when the metadata provider is missing or empty", () => {
		expect(() => findMetadataProvider([{ id: "zai", name: "x", auth: {} as Provider["auth"], getModels: () => [] } as Provider])).toThrow();
		const { provider } = fakeMetadata();
		expect(() => createMetadataIndex({ ...provider, getModels: () => [] })).toThrow();
	});
});

describe("bindModel", () => {
	it("rebinds provider and endpoint, keeps official fields, forces Z.ai compat", () => {
		const { models } = fakeMetadata();
		const bound = bindModel(models[0], "my-zai", "http://127.0.0.1:9/v1");
		expect(bound.provider).toBe("my-zai");
		expect(bound.baseUrl).toBe("http://127.0.0.1:9/v1");
		expect(bound.contextWindow).toBe(models[0].contextWindow);
		expect(bound.compat).toMatchObject({
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			thinkingFormat: "zai",
		});
	});

	it("official explicit compat wins over localhost defaults", () => {
		const { models } = fakeMetadata();
		const explicit = { ...models[0], compat: { supportsDeveloperRole: true } } as Model;
		expect(bindModel(explicit, "my-zai", "http://127.0.0.1:9/v1").compat?.supportsDeveloperRole).toBe(true);
	});
});

describe("catalog lifecycle", () => {
	it("baseline lists all known models before any network; gateway list replaces it", async () => {
		const { provider, models } = fakeMetadata();
		const metadata = createMetadataIndex(provider);
		const calls: string[] = [];
		let listing = ["glm-5.3", "glm-unknown"];
		const globalFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL) => {
			calls.push(String(url));
			return new Response(JSON.stringify({ data: listing.map((id) => ({ id })) }), { status: 200 });
		}) as typeof fetch;
		try {
			const auth = {
				name: "k",
				resolve: async () => ({ auth: { apiKey: "gw" } }),
			};
			const catalog = createModelCatalog("my-zai", auth, metadata, "http://127.0.0.1:9/v1", async () => ({ kind: "ok", value: "http://127.0.0.1:9/v1" }));
			expect(catalog.models().map((model) => model.id)).toEqual(["glm-5.3", "glm-4.6"]);
			const context: RefreshModelsContext = {
				allowNetwork: true,
				signal: new AbortController().signal,
				publish: async (publication) => {
					publication.update?.();
					return true;
				},
			};
			await catalog.refresh(context);
			expect(catalog.models().map((model) => model.id)).toEqual(["glm-5.3"]);
			expect(catalog.models()[0]?.provider).toBe("my-zai");
			listing = [];
			await catalog.refresh({ ...context, force: true });
			expect(catalog.models()).toEqual([]);
			expect(calls.length).toBe(2);
		} finally {
			globalThis.fetch = globalFetch;
		}
	});

	it("offline refresh does no IO and keeps the current list", async () => {
		const { provider } = fakeMetadata();
		const metadata = createMetadataIndex(provider);
		const catalog = createModelCatalog("my-zai", { name: "k", resolve: async () => undefined }, metadata, "http://127.0.0.1:9/v1", async () => {
			throw new Error("must not ensure backend offline");
		});
		await catalog.refresh({ allowNetwork: false, signal: new AbortController().signal, publish: async () => true });
		expect(catalog.models().length).toBe(2);
	});
});

describe("fetchModelIds", () => {
	it("validates envelope shapes", async () => {
		const cases: [BodyInit, string | undefined][] = [
			[JSON.stringify({ data: [{ id: " a " }, { id: "a" }, { id: "b" }] }), "a,b"],
			[JSON.stringify({ data: [] }), ""],
		];
		const globalFetch = globalThis.fetch;
		globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
			const body = cases[0][0];
			cases.shift();
			void init;
			return new Response(body, { status: 200 });
		}) as typeof fetch;
		try {
			expect((await fetchModelIds("http://127.0.0.1:9/v1", "gw", new AbortController().signal)).kind).toBe("ok");
		} finally {
			globalThis.fetch = globalFetch;
		}
	});
});
