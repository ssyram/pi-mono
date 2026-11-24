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
import { createCatalogOwner } from "./official-catalog/catalog-owner.js";
import { builtinIds, getBase, isOAuthSource, shouldForwardFilterModels, supportedSourceIds } from "./provider-source.js";
import { type RegistrationItem, registerInstances } from "./registrar.js";

export function profileConfigPath(): string {
	return join(getAgentDir(), "provider-profiles.json");
}

/** Safe stderr for print/json modes: warnings never enter the model stdout
 * protocol, and a failing stderr write must never break the extension. */
function safeStderr(message: string, level: string): void {
	try {
		process.stderr.write(`[provider-profiles] ${level}: ${message}\n`);
	} catch {
		// Physical output unavailability is an environment premise, not an error.
	}
}

export default async function providerProfilesExtension(pi: ExtensionAPI): Promise<void> {
	const agentDir = getAgentDir();
	const catalogOwner = createCatalogOwner(agentDir);
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
			const original = instanceProvider(getBase(entry.provider), entry, shouldForwardFilterModels(entry.provider));
			items.push({
				entry,
				provider: await catalogOwner.compose(original, entry.provider),
			});
		} catch (error) {
			constructionErrors.push({
				name: entry.name,
				reason: `construction failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	const outcome = registerInstances(pi, items);
	registerAddLoginCommand(
		pi,
		join(agentDir, "provider-profiles.json"),
		join(agentDir, "models.json"),
		catalogOwner,
	);
	pi.on("session_start", (_event, ctx) => {
		catalogOwner.attach({
			notify: (message, level) => {
				if (ctx.hasUI) ctx.ui.notify(message, level);
				else safeStderr(message, level);
			},
			onUpdated: (ids) => ctx.modelRegistry.refresh({ allowNetwork: false, providers: [...ids] }),
		});
	});
	pi.on("session_shutdown", () => catalogOwner.dispose());
	for (const error of [...errors, ...constructionErrors, ...outcome.failed] as EntryError[]) {
		console.error(`[provider-profiles] entry "${error.name}" skipped: ${error.reason}`);
	}
	if (outcome.registered.length > 0) {
		console.log(`[provider-profiles] registered: ${outcome.registered.join(", ")}`);
	}
}
