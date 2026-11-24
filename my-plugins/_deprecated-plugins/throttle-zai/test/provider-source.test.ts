import { describe, expect, it } from "vitest";
import type { AssistantMessageEventStream, Model, Provider, TranscriptContext } from "@earendil-works/pi-ai";
import { createProviderSource, createThrottleProvider } from "../src/provider-source.js";
import { PROVIDER_SOURCE_QUERY, PROVIDER_SOURCE_READY, provideProviderSource, resolveProviderSource } from "../src/source-contract.js";
import type { BackendOwner } from "../src/backend-owner.js";
import type { PluginConfig, PluginPaths } from "../src/plugin-config.js";
import { fakeBus } from "./helpers.js";

const metadata = new Map<string, Model>([
	[
		"glm-5.3",
		{
			id: "glm-5.3",
			name: "GLM 5.3",
			provider: "zai-coding-cn",
			api: "openai-completions",
			reasoning: true,
			input: ["text"],
			contextWindow: 1000,
			maxTokens: 100,
		} as Model,
	],
]);

const nativeStream = { marker: "native" } as unknown as AssistantMessageEventStream;
let lastNativeCall: { model: Model; baseUrl: string | undefined } | undefined;
const nativeProvider: Provider = {
	id: "zai-coding-cn",
	name: "native",
	auth: {} as Provider["auth"],
	getModels: () => [],
	stream: (model: Model) => {
		lastNativeCall = { model, baseUrl: model.baseUrl };
		return nativeStream;
	},
	streamSimple: (model: Model) => {
		lastNativeCall = { model, baseUrl: model.baseUrl };
		return nativeStream;
	},
};

function ownerStub(): BackendOwner & { bound: object[] } {
	const bound: object[] = [];
	return {
		relayBaseUrl: "http://127.0.0.1:9/v1",
		bound,
		bindInstance(provider) {
			bound.push(provider);
		},
		owns(provider, selection) {
			return bound.includes(provider as object) && selection.providerId === (provider as Provider).id && selection.endpoint === this.relayBaseUrl && selection.api === "openai-completions";
		},
		async ensureRunning() {
			return { kind: "ok", value: { instanceId: "i", controlUrl: "http://127.0.0.1:1", relayBaseUrl: this.relayBaseUrl } };
		},
		async managementSession() {
			throw new Error("not needed");
		},
		async readOwnedSnapshot() {
			throw new Error("not needed");
		},
		invalidateReady() {
			undefined;
		},
	};
}

function deps(owner: ReturnType<typeof ownerStub>) {
	const config: PluginConfig = {
		version: 1,
		executable: "/bin/qt",
		controlUrl: "http://127.0.0.1:1",
		relayBaseUrl: "http://127.0.0.1:9/v1",
		plan: { kind: "personal" },
		quota: { kind: "equal" },
	};
	const paths: PluginPaths = {
		configFile: "/tmp/c.json",
		stateDir: "/tmp/s",
		bootstrapFile: "/tmp/s/b.json",
		clientsDir: "/tmp/s/clients",
		backendDir: "/tmp/b",
		backendConfigFile: "/tmp/b/config.toml",
	};
	return { config, paths, nativeProvider, metadata, owner };
}

describe("throttle provider", () => {
	it("creates an instance with baseline models, auth login and lazy native streams", async () => {
		const owner = ownerStub();
		const provider = createThrottleProvider({ id: "my-zai" }, deps(owner));
		expect(provider.id).toBe("my-zai");
		expect(provider.baseUrl).toBe("http://127.0.0.1:9/v1");
		expect(provider.getModels().map((model) => model.id)).toEqual(["glm-5.3"]);
		expect(provider.getModels()[0]?.provider).toBe("my-zai");
		expect(typeof provider.auth.apiKey?.login).toBe("function");
		const context = {} as TranscriptContext;
		const stream = provider.stream(provider.getModels()[0] as Model, context);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(stream).toBeDefined();
		expect(lastNativeCall?.baseUrl).toBe("http://127.0.0.1:9/v1");
		expect(owner.bound).toContain(provider);
	});

	it("instances do not share catalog state and ownership binds per provider", () => {
		const owner = ownerStub();
		const { create } = { create: (id: string) => createThrottleProvider({ id }, deps(owner)) };
		const first = create("my-zai");
		const second = create("other-zai");
		expect(first.getModels()[0]).not.toBe(second.getModels()[0]);
		expect(owner.owns(first, { providerId: "my-zai", modelId: "glm-5.3", api: "openai-completions", endpoint: "http://127.0.0.1:9/v1" })).toBe(true);
		expect(owner.owns(first, { providerId: "other-zai", modelId: "glm-5.3", api: "openai-completions", endpoint: "http://127.0.0.1:9/v1" })).toBe(false);
		expect(owner.owns(second, { providerId: "other-zai", modelId: "glm-5.3", api: "openai-completions", endpoint: "http://127.0.0.1:9/v1" })).toBe(true);
	});
});

describe("source contract", () => {
	it("resolve is synchronous-only; last reply wins; provide answers queries", () => {
		const bus = fakeBus();
		const warnings: string[] = [];
		expect(resolveProviderSource("throttle-zai", bus, (message) => warnings.push(message))).toBeUndefined();
		const owner = ownerStub();
		const source = createProviderSource(deps(owner));
		let events: { emit(channel: string, data: unknown): void; handlers: Map<string, ((data: unknown) => void)[]> } | undefined;
		const fakePi = {
			events: {
				emit: (channel: string, data: unknown) => events?.emit(channel, data),
				on: (channel: string, handler: (data: unknown) => void) => bus.on(channel, handler),
			},
		};
		events = bus as unknown as { emit(channel: string, data: unknown): void };
		const second = createProviderSource(deps(ownerStub()));
		bus.on(PROVIDER_SOURCE_QUERY, (data) => {
			(data as { accept(source: unknown): void }).accept(second);
		});
		provideProviderSource("throttle-zai", source, fakePi);
		const resolved = resolveProviderSource("throttle-zai", bus, (message) => warnings.push(message));
		expect(warnings.join("; ")).toContain("last synchronous reply wins");
		expect(resolved).toBeDefined();
		expect(resolved?.create({ id: "my-zai" }).id).toBe("my-zai");
		void PROVIDER_SOURCE_READY;
	});
});
