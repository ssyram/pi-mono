/** Extension entry: validate config, wire owner/source/usage, publish source last. */
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { failureMessage } from "./backend-failure.js";
import { createBackendOwner } from "./backend-owner.js";
import { createMetadataIndex, officialMetadataProvider } from "./model-catalog.js";
import { loadPluginConfig, pluginPaths } from "./plugin-config.js";
import { createProviderSource } from "./provider-source.js";
import { provideProviderSource } from "./source-contract.js";
import { registerUsageService } from "./usage-service.js";

export default async function throttleZaiExtension(pi: ExtensionAPI): Promise<void> {
	const paths = pluginPaths(getAgentDir());
	const config = await loadPluginConfig(paths.configFile);
	if (config.kind !== "ok") {
		throw new Error(`[throttle-zai] ${failureMessage(config)}`);
	}
	const pluginConfig = config.value;
	const metadataProvider = officialMetadataProvider();
	const metadata = createMetadataIndex(metadataProvider);
	const owner = createBackendOwner(pluginConfig, paths, [...metadata.keys()]);
	registerUsageService(pi, owner, pluginConfig.quota);
	const source = createProviderSource({ config: pluginConfig, paths, nativeProvider: metadataProvider, metadata, owner });
	provideProviderSource("throttle-zai", source, pi);
}
