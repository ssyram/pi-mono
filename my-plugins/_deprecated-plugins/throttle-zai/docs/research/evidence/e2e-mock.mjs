// End-to-end mock walk: fake E3 control + fake E4 new-api (admin/models/SSE), real internal modules.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "node:http";

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (specifier.endsWith(".js")) {
				const base = specifier.replace(/^.*\//, "").slice(0, -3);
				for (const dir of ["../../../src/", "./"]) {
					const source = new URL(`${dir}${base}.ts`, import.meta.url);
					if (existsSync(fileURLToPath(source))) return { url: source.href, shortCircuit: true };
				}
			}
			throw error;
		}
	},
});

const root = await mkdtemp(join(tmpdir(), "tz-e2e-"));

// --- gather real GLM upstream keys from provider-profiles (never printed) ---
const profilePath = join(process.env.HOME ?? "~", ".pi", "agent", "provider-profiles.json");
let poolKeys = [];
let keySource = "provider-profiles";
try {
	const raw = JSON.parse(await readFile(profilePath, "utf-8"));
	for (const [name, entry] of Object.entries(raw)) {
		if (typeof entry?.provider === "string" && entry.provider.startsWith("zai") && typeof entry.apiKey === "string") {
			const resolved = entry.apiKey.includes("$")
				? entry.apiKey.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, n) => process.env[n] ?? "")
				: entry.apiKey;
			if (resolved && !resolved.includes("$")) poolKeys.push({ name, key: resolved });
		}
	}
} catch {
	poolKeys = [];
}
if (poolKeys.length === 0) {
	keySource = "synthetic";
	poolKeys = [
		{ name: "zai-mock-a", key: "sk-mock-aaaaaaaaaaaa" },
		{ name: "zai-mock-b", key: "sk-mock-bbbbbbbbbbbb" },
	];
}
const upstreamKey = poolKeys[0].key;
const tag = `acct-${createHash("sha256").update(upstreamKey).digest("hex").slice(0, 12)}`;

// --- fake new-api (relay origin): admin + models + SSE chat ---
let tokenName = "";
let relayAuth = "";
const relayOptions = {
	GroupRatio: JSON.stringify({ default: 0 }),
	ModelRatio: JSON.stringify({ "glm-5.3": 0 }),
};
const relay = createServer((request, response) => {
	const path = new URL(request.url ?? "/", "http://x").pathname;
	const chunks = [];
	request.on("data", (c) => chunks.push(c));
	request.on("end", () => {
		const body = Buffer.concat(chunks).toString("utf-8");
		const json = (status, payload, headers) => {
			response.writeHead(status, { "content-type": "application/json", ...(headers ?? {}) });
			response.end(payload === undefined ? "" : JSON.stringify(payload));
		};
		if (path === "/api/status" && request.method === "GET") return json(200, {});
		if (path === "/api/user/login" && request.method === "POST") {
			return json(200, { success: true, data: { id: 1 } }, { "set-cookie": "session=e2e; Path=/" });
		}
		if (path === "/api/option/" && request.method === "GET") {
			return json(200, { success: true, data: relayOptions });
		}
		if (path === "/api/option/" && request.method === "PUT") {
			const parsed = JSON.parse(body || "{}");
			if (typeof parsed?.key === "string" && typeof parsed?.value === "string") relayOptions[parsed.key] = parsed.value;
			return json(200, { success: true, message: "" });
		}
		if (path === "/api/user/self" && request.method === "GET") {
			return json(200, { success: true, data: { id: 1, quota: 100000 } });
		}
		if (path === "/api/token/" && request.method === "GET") {
			const items = tokenName === "" ? [] : [{ id: 1, name: tokenName, status: 1, group: "default", unlimited_quota: true, expired_time: -1 }];
			return json(200, { success: true, data: { items, total: items.length } });
		}
		if (path === "/api/token/" && request.method === "POST") {
			tokenName = (JSON.parse(body || "{}").name ?? "");
			return json(200, { success: true, message: "" });
		}
		if (path === "/api/token/1" && request.method === "GET") {
			return json(200, { success: true, data: { id: 1, name: tokenName, status: 1, group: "default", unlimited_quota: true, expired_time: -1 } });
		}
		if (path === "/api/token/1/key" && request.method === "POST") {
			return json(200, { success: true, data: { key: "sk-gateway-e2e" } });
		}
		if (path === "/v1/models" && request.method === "GET") {
			return json(200, { data: [{ id: "glm-5.3" }, { id: "glm-5.3-flash" }] });
		}
		if (path === "/v1/chat/completions" && request.method === "POST") {
			relayAuth = request.headers.authorization ?? "";
			response.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (delta, finish = null, usage) =>
				`data: ${JSON.stringify({ id: "e2e", object: "chat.completion.chunk", model: "glm-5.3", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
			response.write(chunk({ role: "assistant", content: "" }));
			response.write(chunk({ content: "mock-ok" }));
			response.write(chunk({}, "stop", { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }));
			response.write("data: [DONE]\n\n");
			response.end();
			return;
		}
		json(404, { error: "not found" });
	});
});

// --- fake quota-throttle control ---
let addedCount = 0;
let mockInstanceId = "e2e-inst";
const control = createServer((request, response) => {
	const path = new URL(request.url ?? "/", "http://x").pathname;
	const chunks = [];
	request.on("data", (c) => chunks.push(c));
	request.on("end", () => {
		const json = (status, payload) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(payload));
		};
		if (path === "/api/status.service") {
			return json(200, { name: "quota-throttle", apiVersion: 1, instanceId: mockInstanceId, phase: "ready", poll_interval_secs: 60 });
		}
		if (path === "/api/status") {
			const keys = poolKeys.map((entry, index) => ({
				name: index === 0 && addedCount > 0 ? tag : `acct-fake-${index}`,
				channel_id: index + 1,
				five_hour_pct: [20, 60][index % 2],
				weekly_pct: [40, 80][index % 2],
				max_pct: 60,
				tier: index === 0 ? "active" : "standby",
			}));
			return json(200, {
				updated_at: Date.now(), dry_run: false, new_api_healthy: true,
				new_api_base: relay.url, client_endpoint: `${relay.url}/v1`,
				keys, channels: keys.map((k) => ({ id: k.channel_id, enabled: true, group: "default" })),
			});
		}
		if (path === "/api/keys" && request.method === "POST") {
			addedCount++;
			const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
			return json(201, { kind: "added", name: parsed.name, channel_id: 99 });
		}
		if (path === "/api/backend/ensure") return json(200, { kind: "ready", instanceId: "e2e-inst" });
		json(404, { error: "not found" });
	});
});

await new Promise((r) => relay.listen(0, "127.0.0.1", r));
await new Promise((r) => control.listen(0, "127.0.0.1", r));
relay.url = `http://127.0.0.1:${relay.address().port}`;
control.url = `http://127.0.0.1:${control.address().port}`;

const { createBackendOwner } = await import("./src/backend-owner.js");
const { createBootstrapState } = await import("./src/backend-bootstrap.js");
const { createProviderSource } = await import("./src/provider-source.js");
const { officialMetadataProvider, createMetadataIndex } = await import("./src/model-catalog.js");
const { registerUsageService } = await import("./src/usage-service.js");
const { PROVIDER_USAGE_QUERY } = await import("./src/usage-contract.js");
const { PROVIDER_SOURCE_QUERY, provideProviderSource } = await import("./src/source-contract.js");
const { ModelRuntime } = await import("/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
const { InMemoryCredentialStore, InMemoryModelsStore } = await import("/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/index.js");

const bootstrap = await createBootstrapState(join(root, "state", "bootstrap.json"));
if (bootstrap.kind !== "ok") throw new Error("bootstrap failed");
mockInstanceId = bootstrap.value.instanceId;
const metadataProvider = officialMetadataProvider();
const metadata = createMetadataIndex(metadataProvider);
const config = {
	version: 1, executable: "/nonexistent/qt", controlUrl: control.url, relayBaseUrl: `${relay.url}/v1`,
	plan: { kind: "personal" }, quota: { kind: "equal" },
};
const paths = {
	configFile: join(root, "config.json"), stateDir: join(root, "state"),
	bootstrapFile: join(root, "state", "bootstrap.json"), clientsDir: join(root, "state", "clients"),
	backendDir: join(root, "backend"), backendConfigFile: join(root, "backend", "config.toml"),
};
const owner = createBackendOwner(config, paths, [...metadata.keys()]);
const source = createProviderSource({ config, paths, nativeProvider: metadataProvider, metadata, owner });

const bus = {
	handlers: new Map(),
	emit(channel, data) { for (const h of this.handlers.get(channel) ?? []) h(data); },
	on(channel, h) { const l = this.handlers.get(channel) ?? []; l.push(h); this.handlers.set(channel, l); },
};
provideProviderSource("throttle-zai", source, { events: bus });
let resolved;
bus.emit(PROVIDER_SOURCE_QUERY, { id: "throttle-zai", accept: (s) => { resolved = s; } });
if (!resolved) throw new Error("source not resolvable");
const provider = resolved.create({ id: "tz-e2e" });

const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
runtime.registerNativeProvider(provider);
await runtime.refresh({ allowNetwork: false });
const baselineCount = runtime.getModels("tz-e2e").length;
if (baselineCount === 0) throw new Error("no baseline models");

await runtime.login("tz-e2e", "api_key", { prompt: async () => upstreamKey, notify: () => {} });
await runtime.refresh({ allowNetwork: false });
if (!runtime.hasConfiguredAuth("tz-e2e")) throw new Error("not configured after login");
if (addedCount !== 1) throw new Error(`addKey calls=${addedCount}`);

const refreshed = await runtime.refresh({ allowNetwork: true, providers: ["tz-e2e"] });
const refreshError = refreshed.errors.get("tz-e2e");
if (refreshError) throw new Error(`refresh failed: ${refreshError}`);
const ids = runtime.getModels("tz-e2e").map((m) => m.id).sort();
if (ids.join(",") !== "glm-5.3,glm-5.3-flash") throw new Error(`unexpected catalog: ${ids}`);
const model = runtime.getModel("tz-e2e", "glm-5.3");
if (!model || model.baseUrl !== `${relay.url}/v1`) throw new Error("model binding wrong");

const events = [];
const stream = runtime.streamSimple(model, { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }, { signal: new AbortController().signal });
for await (const event of stream) events.push(event);
const text = JSON.stringify(events);
if (!text.includes("mock-ok")) throw new Error("stream did not deliver mock-ok");
if (relayAuth !== "Bearer sk-gateway-e2e") throw new Error(`relay auth: ${relayAuth}`);

registerUsageService({ events: bus }, owner, config.quota);
const usage = await new Promise((resolveUsage, reject) => {
	let accepted;
	bus.emit(PROVIDER_USAGE_QUERY, {
		session: {}, nativeProvider: provider, signal: new AbortController().signal,
		selection: { providerId: "tz-e2e", modelId: "glm-5.3", api: "openai-completions", endpoint: `${relay.url}/v1` },
		accept: (promise) => { accepted = promise; },
	});
	if (!accepted) reject(new Error("usage not claimed"));
	else accepted.then(resolveUsage, reject);
});
const n = poolKeys.length;
const exp5h = Math.round(((n - Math.floor(n / 2)) * 20 + Math.floor(n / 2) * 60) / n * 10) / 10;
const expWeek = Math.round(((n - Math.floor(n / 2)) * 40 + Math.floor(n / 2) * 80) / n * 10) / 10;
if (usage.kind !== "available" || !usage.compact.includes(`5h ≈${exp5h}%`) || !usage.compact.includes(`week ≈${expWeek}%`)) {
	throw new Error(`usage: ${JSON.stringify(usage)}`);
}
if (!usage.text.includes("acct-")) throw new Error("per-key detail missing");

await rm(root, { recursive: true, force: true });
await new Promise((r) => relay.close(r));
await new Promise((r) => control.close(r));
console.log(JSON.stringify({
	result: "end-to-end mock passed",
	poolKeys: poolKeys.length, keySource,
	steps: {
		sourceResolved: true, providerCreated: provider.id,
		baselineModels: baselineCount,
		loginStoredCredential: true, addKeyCalls: addedCount,
		catalogAfterRefresh: ids,
		streamText: "mock-ok", relayAuth: "gateway token",
		usageCompact: usage.compact,
	},
}, null, 2));
