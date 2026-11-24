/**
 * provider-profiles extension factory: config → validated entries → official
 * base instances → registration (docs/detailed.md, six-step orchestration).
 *
 * Failure taxonomy (P.local.6): whole-config errors throw (Pi marks the
 * extension failed — nothing registers); per-entry errors are logged via
 * console.error and the remaining entries register independently.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { EntryError } from "./config-entry.js";
import { parseEntries } from "./config-entry.js";
import { readModelsJsonConflicts, readProfileConfig } from "./config-loader.js";
import { registerAddLoginCommand } from "./commands.js";
import { instanceProvider } from "./instantiator.js";
import { builtinIds, getBase, isOAuthSource, shouldForwardFilterModels, supportedSourceIds } from "./provider-source.js";
import { type RegistrationItem, registerInstances } from "./registrar.js";

export function profileConfigPath(): string {
	return join(getAgentDir(), "provider-profiles.json");
}

export default async function providerProfilesExtension(pi: ExtensionAPI): Promise<void> {
	const agentDir = getAgentDir();
	const raw = await readProfileConfig(join(agentDir, "provider-profiles.json"));
	const modelsJsonConflicts = await readModelsJsonConflicts(join(agentDir, "models.json"));
	const sources = supportedSourceIds();
	const validation = {
		nameDenylist: builtinIds(),
		modelsJsonConflicts,
		supportedSources: new Set(sources),
		oauthSources: new Set(sources.filter((id) => isOAuthSource(id))),
	};
	const { entries, errors } = parseEntries(raw, validation);
	const items: RegistrationItem[] = [];
	const constructionErrors: EntryError[] = [];
	for (const entry of entries) {
		try {
			items.push({
				entry,
				provider: instanceProvider(getBase(entry.provider), entry, shouldForwardFilterModels(entry.provider)),
			});
		} catch (error) {
			constructionErrors.push({
				name: entry.name,
				reason: `construction failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	const outcome = registerInstances(pi, items);
	registerAddLoginCommand(pi, join(agentDir, "provider-profiles.json"), join(agentDir, "models.json"));
	for (const error of [...errors, ...constructionErrors, ...outcome.failed] as EntryError[]) {
		console.error(`[provider-profiles] entry "${error.name}" skipped: ${error.reason}`);
	}
	if (outcome.registered.length > 0) {
		console.log(`[provider-profiles] registered: ${outcome.registered.join(", ")}`);
	}
}
