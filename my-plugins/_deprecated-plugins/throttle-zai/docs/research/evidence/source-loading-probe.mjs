// Research-only loader instrumentation; product code would use only ExtensionAPI and the source contract.
import assert from "node:assert/strict";
import {
	createProvider, InMemoryCredentialStore, InMemoryModelsStore,
} from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/index.js";
import { builtinProviders } from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/providers/all.js";
import {
	createEventBus, createExtensionRuntime, ModelRuntime, resolveCliModel,
} from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { loadExtensionFromFactory } from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { profileConsumer } from "./profile-consumer-probe.mjs";
import { publishSource } from "./provider-service-probe.mjs";

let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
const official = builtinProviders().find((provider) => provider.id === "zai-coding-cn");
const template = official.getModels().find((model) => model.id === "glm-5.3");
assert(template);
const api = {
	stream() { throw new Error("model requests forbidden"); },
	streamSimple() { throw new Error("model requests forbidden"); },
};
function source(contextWindow = template.contextWindow) {
	return {
		create(profile) {
			const model = {
				...template, provider: profile.id, baseUrl: "http://127.0.0.1:1/v1", contextWindow,
				compat: { ...template.compat, supportsDeveloperRole: false, supportsReasoningEffort: false,
					maxTokensField: "max_tokens", thinkingFormat: "zai" },
			};
			return createProvider({
				id: profile.id, baseUrl: model.baseUrl, models: [model], api,
				auth: { apiKey: { name: "Probe gateway key", resolve: ({ credential }) => {
					const key = credential?.key ?? profile.apiKey;
					return key ? { auth: { apiKey: key } } : undefined;
				} } },
				fetchModels: async () => [model],
			});
		},
	};
}
const profiles = [
	{ name: "my-zai", provider: "throttle-zai", apiKey: "dummy-key-a" },
	{ name: "other-zai", provider: "throttle-zai", apiKey: "dummy-key-b" },
];
async function runCase(label, order, expected, options = {}) {
	const bus = createEventBus();
	const extensionRuntime = createExtensionRuntime();
	const observed = { warnings: [], errors: [] };
	const primary = source();
	const replacement = source(65536);
	const native = new Map([["builtin-probe", source()]]);
	if (options.shadow) native.set("throttle-zai", source(32000));
	const nativeProfile = { name: "native-profile", provider: "builtin-probe", apiKey: "dummy-native-key" };
	const consumer = profileConsumer([{ id: "throttle-zai" }], [...profiles, nativeProfile], native, observed);
	const factories = {
		consumer,
		producer: async (pi) => { await Promise.resolve(); publishSource(pi, "throttle-zai", primary); },
		replacement: (pi) => publishSource(pi, "throttle-zai", replacement),
		throwing: (pi) => publishSource(pi, "throttle-zai", { create() { throw new Error("probe construction failure"); } }),
		wrongId: (pi) => publishSource(pi, "throttle-zai", { create: (profile) => primary.create({ ...profile, id: "wrong-id" }) }),
	};
	for (const name of order) {
		await loadExtensionFromFactory(factories[name], process.cwd(), bus, extensionRuntime, `<probe:${label}:${name}>`);
	}
	const queued = extensionRuntime.pendingNativeProviderRegistrations.map(({ provider }) => provider);
	const store = new InMemoryModelsStore();
	const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: store,
		modelsPath: null, refreshOnCreate: false });
	for (const provider of queued) runtime.registerNativeProvider(provider);
	const ids = [...new Set(queued.map((provider) => provider.id))];
	const refreshed = await runtime.refresh({ allowNetwork: false });
	assert.equal(refreshed.errors.size, 0);
	assert.equal(runtime.getModel("native-profile", "glm-5.3")?.provider, "native-profile");
	assert(runtime.hasConfiguredAuth("native-profile"));
	const resolved = resolveCliModel({ cliModel: "my-zai/glm-5.3", modelRuntime: runtime });
	if (expected === "available") {
		assert.equal(resolved.error, undefined);
		assert.equal(resolved.model?.provider, "my-zai");
		assert.equal(resolved.model?.contextWindow, options.replaced ? 65536 : template.contextWindow);
		assert(runtime.hasConfiguredAuth("my-zai"));
		assert(runtime.hasConfiguredAuth("other-zai"));
		const dynamic = await runtime.refresh({ allowNetwork: true, providers: ids });
		assert.equal(dynamic.errors.size, 0);
		for (const id of ids) {
			const saved = await store.read(id);
			assert(saved);
			assert(saved.models.every((model) => model.provider === id));
		}
		assert.equal(await store.read("throttle-zai"), undefined);
	} else {
		assert.equal(resolved.model, undefined);
		assert(resolved.error);
		assert(!queued.some((provider) => provider.id === "my-zai"));
	}
	if (options.shadow) assert(observed.warnings.some((warning) => warning.includes("source override")));
	if (options.replaced) assert(observed.warnings.some((warning) => warning.includes("last synchronous reply wins")));
	if (options.failed) assert.equal(observed.errors.length, profiles.length);
	return { label, result: "passed", queuedProviderCount: queued.length,
		modelVisibleBeforeSessionStart: Boolean(resolved.model), unrelatedProfileUnaffected: true,
		warnings: observed.warnings, errorCount: observed.errors.length };
}
const cases = [];
cases.push(await runCase("provider-first", ["producer", "consumer"], "available"));
cases.push(await runCase("profiles-first", ["consumer", "producer"], "available"));
cases.push(await runCase("declared-source-overrides-native", ["consumer", "producer"], "available", { shadow: true }));
cases.push(await runCase("missing-service-does-not-fallback", ["consumer"], "unavailable", { shadow: true }));
cases.push(await runCase("constructor-error-isolated", ["producer", "consumer", "throwing"], "unavailable", { failed: true }));
cases.push(await runCase("wrong-instance-id-rejected", ["consumer", "wrongId"], "unavailable", { failed: true }));
cases.push(await runCase("later-service-replaces-earlier", ["producer", "consumer", "replacement"], "available", { replaced: true }));
assert.equal(networkCalls, 0);
console.log(JSON.stringify({ piVersion: "1.4.0", nodeVersion: process.version, cases, networkCalls,
	limitations: ["No production plugin changed", "Loader internal entry used only as test instrumentation",
		"No real gateway, credentials, UI login, disk config mutation or model request", "Provider publishing ready then throwing violates the proposed contract and is not covered"] }, null, 2));
