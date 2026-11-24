// Exercises cache-first alias restoration before the source provider can be looked up; not production code.
import assert from "node:assert/strict";
import { InMemoryCredentialStore, InMemoryModelsStore } from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/index.js";
import { ModelRuntime } from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

function cachedAlias(id, binding) {
	let catalog = [];
	return {
		id,
		name: id,
		auth: {
			apiKey: {
				name: "Probe configured profile key",
				resolve: () => ({ auth: { apiKey: "dummy-cached-alias-value" }, source: "probe profile config" }),
			},
		},
		getModels: () => catalog,
		async refreshModels(context) {
			if (context.stored) {
				await context.publish({ update: () => { catalog = context.stored.models; } });
			}
			if (!context.allowNetwork) return;
			assert(binding.source, "source must be bound before fetching a new catalog");
			const models = binding.source.getModels().map((model) => ({ ...model, provider: id }));
			assert(await context.publish({ persist: { models }, update: () => { catalog = models; } }));
		},
		stream: (...args) => binding.source.stream(...args),
		streamSimple: (...args) => binding.source.streamSimple(...args),
	};
}

export async function probeCachedAlias(source, modelId) {
	const store = new InMemoryModelsStore();
	const first = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(), modelsStore: store, modelsPath: null, refreshOnCreate: false,
	});
	const firstBinding = { source };
	first.registerNativeProvider(cachedAlias("cached-probe", firstBinding));
	await first.refresh({ allowNetwork: false, providers: ["cached-probe"] });
	const published = await first.refresh({ allowNetwork: true, providers: ["cached-probe"] });
	assert.equal(published.errors.size, 0);
	assert.equal(first.getModel("cached-probe", modelId)?.provider, "cached-probe");
	assert(await store.read("cached-probe"));

	const restarted = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(), modelsStore: store, modelsPath: null, refreshOnCreate: false,
	});
	const restartedBinding = {};
	restarted.registerNativeProvider(cachedAlias("cached-probe", restartedBinding));
	const restored = await restarted.refresh({ allowNetwork: false, providers: ["cached-probe"] });
	assert.equal(restored.errors.size, 0);
	assert.equal(restartedBinding.source, undefined);
	assert.equal(restarted.getModel("cached-probe", modelId)?.provider, "cached-probe");
	assert(restarted.hasConfiguredAuth("cached-probe"));
	assert(restarted.getAvailableSnapshot().some((model) => model.provider === "cached-probe"));
	restartedBinding.source = source;
	return {
		firstLoginPublishesAliasCatalog: "passed",
		restartRestoresAliasWithoutSourceLookup: "passed",
		configuredAliasAvailableBeforeSourceBinding: "passed",
		limitations: ["Store is in-memory across two isolated runtimes", "Source request delegation not exercised", "Cold or deleted catalog still needs interactive refresh"],
	};
}
