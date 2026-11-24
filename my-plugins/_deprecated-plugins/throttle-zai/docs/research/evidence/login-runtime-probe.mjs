// Research-only proof that a public temporary ModelRuntime can persist login for the main runtime.
import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createProvider } from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/index.js";
import { ModelRegistry, ModelRuntime } from "/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
const directory = new URL("./login-fixture/", import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
const authPath = fileURLToPath(new URL("auth.json", directory));
const id = `login-probe-${process.pid}`;
const model = { id: "probe-model", name: "Probe model", api: "openai-completions", provider: id,
	baseUrl: "http://127.0.0.1:1/v1", reasoning: false, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 12345, maxTokens: 1234 };
const provider = createProvider({ id, models: [model], auth: { apiKey: {
	name: "Probe API key", login: async (interaction) => ({ type: "api_key", key: await interaction.prompt({ type: "secret", message: "Probe key" }) }),
	resolve: ({ credential }) => credential?.key ? { auth: { apiKey: credential.key }, source: "stored credential" } : undefined,
} }, api: { stream() { throw new Error("model requests forbidden"); }, streamSimple() { throw new Error("model requests forbidden"); } } });
const main = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
main.registerNativeProvider(provider);
await main.refresh({ allowNetwork: false });
assert.equal(main.hasConfiguredAuth(id), false);
const writer = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
writer.registerNativeProvider(provider);
await writer.login(id, "api_key", { prompt: async () => "dummy-gateway-key", notify() {} });
await main.refresh({ allowNetwork: false });
assert.equal(main.hasConfiguredAuth(id), true);
assert.equal((await new ModelRegistry(main).getApiKeyAndHeaders(main.getModel(id, model.id))).ok, true);
await main.logout(id);
await main.refresh({ allowNetwork: false });
assert.equal(main.hasConfiguredAuth(id), false);
assert.equal(networkCalls, 0);
console.log(JSON.stringify({ piVersion: "1.4.0", nodeVersion: process.version,
	publicRuntimeLoginWritesCredential: "passed", mainRuntimeRefreshSeesExternalLogin: "passed",
	mainRuntimeLogoutRemovesCredential: "passed", profileConfigApiKeyFallbackUsed: false,
	authFixtureMode: ((await stat(authPath)).mode & 0o777).toString(8), networkCalls,
	limitations: ["Fake credential in research directory only", "No real UI, gateway or user auth.json", "No cross-process concurrent login probe"] }, null, 2));
