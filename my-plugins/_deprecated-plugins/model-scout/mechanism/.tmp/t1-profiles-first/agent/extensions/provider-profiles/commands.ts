/**
 * /add-login user command (C5): appends an entry to provider-profiles.json,
 * re-validates the merged config through C1 (unrecognized providers are
 * always rejected), and registers the instance immediately (post-load
 * registerProvider calls apply without restart). Removal is intentionally
 * NOT a command: delete the entry from the file and /logout <name> — see HELP.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { builtinIds, isOAuthSource, shouldForwardFilterModels, supportedSourceIds } from "./provider-source.js";
import type { ProfileEntry } from "./config-entry.js";
import { readModelsJsonConflicts, readProfileConfig } from "./config-loader.js";
import { upsertProfileEntry } from "./config-writer.js";
import { instanceProvider } from "./instantiator.js";
import { getBase } from "./provider-source.js";

const HELP = `[add-login] Usage: /add-login <name> <provider> [apiKey]

Adds a provider-profiles entry and registers it immediately.

  name     ^[a-z0-9][a-z0-9-]{0,63}$; must not collide with built-in provider
           ids, unsafe same-name models.json settings, or reserved storage keys
           (e.g. "constructor")
  provider any recognized built-in provider (Tab lists them; dynamic-catalog
           providers such as radius are not supported)
  apiKey   optional for api-key providers (never for OAuth providers, which
           use /login <name>). Literal, or $ENV_VAR / \${ENV_VAR}
           reference (expanded at use time; "!command" is not supported).
           Avoid secrets in command arguments if your transcripts are shared.

How to remove an entry (deliberately not a command, to avoid residue):
  1. Delete its object from ~/.pi/agent/provider-profiles.json
  2. If it has stored credentials, run /logout <name>
  3. The live instance stays registered until Pi restarts — restart to clear it

help | h | ? | -h | --help  show this text`;

const HELP_KEYS = new Set(["", "help", "h", "?", "-h", "--help"]);

const providerItems = (name: string, partial: string) =>
	fuzzyFilter(supportedSourceIds(), partial, (provider) => provider).map((provider) => ({
		value: `${name} ${provider}`,
		label: provider,
		description: `register ${name} with ${provider}`,
	}));

export function registerAddLoginCommand(pi: ExtensionAPI, configPath: string, modelsJsonPath: string): void {
	pi.registerCommand("add-login", {
		description: "Add a provider-profiles account entry and register it now. /add-login help for details.",
		getArgumentCompletions(argumentPrefix: string) {
			// Position-state model: the argument slot being completed decides the
			// candidates, not the character prefix. States:
			//   A  no name token yet (spaces only)        -> single "help" candidate
			//   B  first token typed, help-like prefix    -> "help"
			//   B' first token is a NAME (not help/flag)  -> provider candidates
			//      (value keeps the name; Tab after a finished name appends provider)
			//   C  name done, provider slot, with or without trailing space -> providers
			//   D  provider done (apiKey slot)            -> no completion
			const trimmed = argumentPrefix.trim();
			const endsWithSpace = /\s$/.test(argumentPrefix);
			const helpItem = [{ value: "help", label: "help", description: "show /add-login help" }];
			if (trimmed === "") return helpItem;
			const tokens = trimmed.split(/\s+/);
			if (tokens.length === 1 && !endsWithSpace) {
				const first = tokens[0] ?? "";
				if ("help".startsWith(first)) return helpItem;
				if (first.startsWith("-") || first === "?") return null;
				return providerItems(first, "");
			}
			if (tokens.length === 1 && endsWithSpace) return providerItems(tokens[0] ?? "", "");
			if (tokens.length === 2 && !endsWithSpace) return providerItems(tokens[0] ?? "", tokens[1] ?? "");
			return null;
		},
		async handler(args, ctx) {
			const trimmed = args.trim();
			if (HELP_KEYS.has(trimmed.toLowerCase())) {
				ctx.ui.notify(HELP, "info");
				return;
			}
			const tokens = trimmed.split(/\s+/);
			if (tokens.length < 2 || tokens.length > 3 || tokens[0] === "") {
				ctx.ui.notify(
					"[add-login] expected 2 or 3 arguments (apiKey must be a single token; use a $ENV_VAR reference or edit the file directly for complex values).\n" +
						HELP,
					"warning",
				);
				return;
			}
			const [name, providerToken, apiKey] = tokens;
			if (!supportedSourceIds().includes(providerToken)) {
				ctx.ui.notify(
					`[add-login] unrecognized provider "${providerToken}" — declined. Tab lists recognized built-in providers`,
					"warning",
				);
				return;
			}
			if (isOAuthSource(providerToken) && apiKey !== undefined) {
				ctx.ui.notify(`[add-login] ${providerToken} uses OAuth login; apiKey is not accepted`, "warning");
				return;
			}
			if (apiKey !== undefined && /\s/.test(apiKey)) {
				ctx.ui.notify(
					"[add-login] apiKey must not contain whitespace; use a $ENV_VAR reference or edit the file directly",
					"warning",
				);
				return;
			}
			const existing = await readProfileConfig(configPath);
			if (Object.prototype.hasOwnProperty.call(existing, name)) {
				ctx.ui.notify(
					`[add-login] "${name}" already exists; edit ~/.pi/agent/provider-profiles.json to change it (deliberately no silent overwrite)`,
					"warning",
				);
				return;
			}
			const modelsJsonConflicts = await readModelsJsonConflicts(modelsJsonPath);
			const validation = {
				nameDenylist: builtinIds(),
				modelsJsonConflicts,
				supportedSources: new Set(supportedSourceIds()),
				oauthSources: new Set(supportedSourceIds().filter((id) => isOAuthSource(id))),
			};
			const entry: ProfileEntry =
				apiKey === undefined ? { name, provider: providerToken } : { name, provider: providerToken, apiKey };
			const result = await upsertProfileEntry(configPath, entry, validation);
			if (!result.ok) {
				ctx.ui.notify(`[add-login] rejected "${name}": ${result.error}`, "warning");
				return;
			}
			try {
				pi.registerProvider(
					instanceProvider(getBase(providerToken), entry, shouldForwardFilterModels(providerToken)),
				);
			} catch (error) {
				ctx.ui.notify(
					`[add-login] saved to file but registration failed: ${error instanceof Error ? error.message : String(error)} (effective after next Pi restart)`,
					"warning",
				);
				return;
			}
			ctx.ui.notify(`[add-login] added and registered ${name} (${providerToken})`, "info");
		},
	});
}
