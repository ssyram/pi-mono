/** Provider construction: one standard Provider per instance, no shared closures. */
import type { Model, Provider } from "@earendil-works/pi-ai";
import { wrapApiKeyAuth } from "./profile-auth.js";
import type { ProviderProfileSpec, ProviderSourceService } from "./source-contract.js";
import { createModelCatalog } from "./model-catalog.js";
import { forwardSimpleStream, forwardStream } from "./request-forward.js";
import { loginGatewayClient } from "./provider-login.js";
import type { BackendOwner } from "./backend-owner.js";
import type { PluginConfig, PluginPaths } from "./plugin-config.js";

export interface SourceDependencies {
	config: PluginConfig;
	paths: PluginPaths;
	nativeProvider: Provider;
	metadata: ReadonlyMap<string, Model>;
	owner: BackendOwner;
}

export function createThrottleProvider(profile: ProviderProfileSpec, deps: SourceDependencies): Provider {
	const { config, paths, nativeProvider, metadata, owner } = deps;
	const auth = wrapApiKeyAuth(
		{
			name: "Gateway API key",
			login: (interaction) =>
				loginGatewayClient(profile.id, interaction, owner, config, paths),
		},
		profile.apiKey,
	);
	const catalog = createModelCatalog(profile.id, auth, metadata, config.relayBaseUrl, async (signal) => {
		const info = await owner.ensureRunning(signal);
		return info.kind === "ok" ? { kind: "ok", value: info.value.relayBaseUrl } : info;
	});
	const provider: Provider = {
		id: profile.id,
		name: `GLM pool (${profile.id})`,
		baseUrl: config.relayBaseUrl,
		auth: { apiKey: auth },
		getModels: () => catalog.models(),
		refreshModels: (context) => catalog.refresh(context),
		stream: (model, context, options) => forwardStream(model, context, owner, nativeProvider, options),
		streamSimple: (model, context, options) =>
			forwardSimpleStream(model, context, owner, nativeProvider, options),
	};
	owner.bindInstance(provider);
	return provider;
}

export function createProviderSource(deps: SourceDependencies): ProviderSourceService {
	return {
		create(profile) {
			return createThrottleProvider(profile, deps);
		},
	};
}
