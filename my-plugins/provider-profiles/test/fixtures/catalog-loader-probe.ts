/**
 * Real-loader probe for the official-catalog module (unwired stage). This
 * file is loaded by the PRODUCTION jiti loader with its real alias map and
 * an isolated PI_CODING_AGENT_DIR, proving the module resolves through the
 * real installed channels (dist coding-agent entry, dist pi-ai view,
 * providers/all). It is a test fixture, never shipped or registered in user
 * settings. The owner is stashed on globalThis so the test can dispose it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createCatalogOwner, type CatalogOwner } from "../../official-catalog/index.js";
import { instanceProvider } from "../../instantiator.js";
import { getBase } from "../../provider-source.js";

const OWNER_KEY = "ppCatalogProbeOwner";

export default async function catalogLoaderProbe(pi: ExtensionAPI): Promise<void> {
	const owner = createCatalogOwner(getAgentDir());
	const original = instanceProvider(getBase("zai"), { name: "zai-loader-probe", provider: "zai" });
	const composed = await owner.compose(original, "zai");
	pi.registerProvider(composed);
	const globals = globalThis as Record<string, unknown>;
	globals[OWNER_KEY] = owner as CatalogOwner;
}

export function probeOwner(): CatalogOwner | undefined {
	return (globalThis as Record<string, unknown>)[OWNER_KEY] as CatalogOwner | undefined;
}
