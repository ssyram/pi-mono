// Runs offline probes against the installed Pi 1.4.0 APIs; no user credentials or model requests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
	createProvider,
	InMemoryCredentialStore,
	InMemoryModelsStore,
} from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/index.js";
import {
	createEventBus,
	ModelRegistry,
	ModelRuntime,
} from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { instanceProvider } from "../../../../provider-profiles/instantiator.ts";
import { upsertProfileEntry } from "../../../../provider-profiles/config-writer.ts";
import { probeCachedAlias } from "./cached-alias-probe.mjs";

let networkCalls = 0;
globalThis.fetch = async () => {
	networkCalls++;
	throw new Error("Network access is forbidden in this probe");
};
const credentials = new InMemoryCredentialStore();
const modelsStore = new InMemoryModelsStore();
const runtime = await ModelRuntime.create({ credentials, modelsStore, modelsPath: null, refreshOnCreate: false });
const registry = new ModelRegistry(runtime);
const initialProviders = runtime.getProviders().map((provider) => provider.id);
const initialRegisteredIds = [...registry.getRegisteredProviderIds()];
assert(initialProviders.includes("zai"));
assert(!initialRegisteredIds.includes("zai"));
const model = {
	id: "probe-model",
	provider: "probe-throttle",
	api: "openai-completions",
	baseUrl: "http://127.0.0.1:1/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 123456,
	maxTokens: 1234,
};
const api = {
	stream() { throw new Error("Model requests are forbidden in this probe"); },
	streamSimple() { throw new Error("Model requests are forbidden in this probe"); },
};
const auth = {
	apiKey: {
		name: "Probe API key",
		async login(interaction) {
			return { type: "api_key", key: await interaction.prompt({ type: "secret", message: "Probe key" }) };
		},
		resolve({ credential }) {
			return credential?.type === "api_key" && credential.key ? { auth: { apiKey: credential.key } } : undefined;
		},
	},
};
const source = createProvider({ id: model.provider, auth, models: [model], api });
registry.registerProvider(source);
assert.equal(registry.getProvider(source.id), source);
assert(registry.getRegisteredProviderIds().includes(source.id));
const alias = instanceProvider(source, { name: "my-probe", provider: source.id });
registry.registerProvider(alias);
await runtime.login(alias.id, "api_key", { prompt: async () => "dummy-probe-value", notify() {} });
assert(await credentials.read(alias.id));
assert.equal(await credentials.read(source.id), undefined);
assert.equal(runtime.getModel(alias.id, model.id)?.provider, alias.id);
assert.equal(runtime.getModel(alias.id, model.id)?.contextWindow, model.contextWindow);
assert.equal((await registry.getApiKeyAndHeaders(runtime.getModel(alias.id, model.id))).ok, true);

const setupCredential = await source.auth.apiKey.login({ prompt: async () => "dummy-profile-value", notify() {} });
const profilePath = new URL("./probe-profile.json", import.meta.url).pathname;
const saved = await upsertProfileEntry(profilePath, {
	name: "restored-probe", provider: source.id, apiKey: setupCredential.key,
}, {
	nameDenylist: new Set(initialProviders), modelsJsonConflicts: new Set(),
	supportedSources: new Set([source.id]), oauthSources: new Set(),
});
assert(saved.ok);
const savedProfile = JSON.parse(await readFile(profilePath, "utf8"))["restored-probe"];
const restoredAlias = instanceProvider(source, { name: "restored-probe", ...savedProfile });
registry.registerProvider(restoredAlias);
await registry.refresh({ allowNetwork: false, providers: [restoredAlias.id] });
assert.equal((await registry.getApiKeyAndHeaders(runtime.getModel(restoredAlias.id, model.id))).ok, true);
assert.equal(await credentials.read(restoredAlias.id), undefined);

const dynamic = createProvider({
	id: "probe-dynamic",
	auth,
	models: [],
	api,
	fetchModels: async () => [{ ...model, provider: "probe-dynamic" }],
});
const dynamicAlias = instanceProvider(dynamic, { name: "my-dynamic-probe", provider: dynamic.id });
assert.equal(typeof dynamic.refreshModels, "function");
assert.equal(dynamicAlias.refreshModels, undefined);
registry.registerProvider(dynamic);
await runtime.login(dynamic.id, "api_key", { prompt: async () => "dummy-dynamic-value", notify() {} });
await runtime.refresh({ allowNetwork: true, providers: [dynamic.id] });
assert.equal(runtime.getModel(dynamic.id, model.id)?.provider, dynamic.id);
assert(await modelsStore.read(dynamic.id));

const bus = createEventBus();
let claimed;
bus.on("probe:usage", (request) => {
	if (request.providerId === alias.id) {
		request.accept(Promise.resolve({ kind: "available", compact: "40%(5h)", text: "pool\nkey-a: 20%\nkey-b: 60%" }));
	}
});
bus.emit("probe:usage", { providerId: alias.id, accept: (promise) => { claimed = promise; } });
assert(claimed);
const usage = await claimed;
assert(usage.text.includes("\nkey-a"));
let unknownClaim;
bus.emit("probe:usage", { providerId: "unknown-probe", accept: (promise) => { unknownClaim = promise; } });
assert.equal(unknownClaim, undefined);

const metadata = ["zai", "zai-coding-cn"].map((id) => {
	const provider = runtime.getProvider(id);
	const found = provider?.getModels().find((entry) => entry.id === "glm-5.3");
	return {
		providerId: id,
		exists: Boolean(provider),
		modelIds: provider?.getModels().map((entry) => entry.id) ?? [],
		glm53: found ? { contextWindow: found.contextWindow, maxTokens: found.maxTokens } : null,
	};
});
const cachedAlias = await probeCachedAlias(source, model.id);
assert.equal(networkCalls, 0);
console.log(JSON.stringify({
	piVersion: "1.4.0",
	publicRuntimeProviderCount: initialProviders.length,
	registeredIdsExcludeBuiltins: !initialRegisteredIds.includes("zai"),
	runtimeZaiHasRefreshModels: typeof runtime.getProvider("zai")?.refreshModels === "function",
	modelRegistryFacade: {
		getProvider: typeof registry.getProvider,
		getProviders: typeof registry.getProviders,
		login: typeof registry.login,
	},
	standardRegistrationAndStaticAlias: "passed",
	loginPersistsUnderAliasInInjectedMemoryStore: "passed",
	providerOwnedApiKeyLoginAndExistingProfilePersistence: "passed",
	profileKeyRestorationWithoutNativeCredentialWrite: "passed",
	aliasContextWindowPreserved: "passed",
	dynamicAliasLosesRefreshModels: "confirmed-current-limitation",
	dynamicSourceCatalogPublication: "passed",
	eventBusSynchronousClaimAsyncResult: "passed",
	unclaimedUsageDistinguished: "passed",
	metadata,
	cachedAlias,
	networkCalls,
	limitations: ["No real auth.json writes", "No extension lifecycle or startup restoration probe", "No real gateway or upstream calls"],
}, null, 2));
