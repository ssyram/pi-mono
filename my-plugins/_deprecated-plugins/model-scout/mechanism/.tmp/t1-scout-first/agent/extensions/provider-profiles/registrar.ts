/**
 * Registration (C4): per-entry failure isolation. One bad registration must
 * not prevent the others (P.local.1); no partially-registered state is used.
 * Instances are not auto-unregistered (T2 unresolved; they live until the Pi
 * process exits). See docs/detailed.md.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import type { EntryError, ProfileEntry } from "./config-entry.js";

export interface RegistrationItem {
	readonly entry: ProfileEntry;
	readonly provider: Provider;
}

export interface RegistrationOutcome {
	readonly registered: string[];
	readonly failed: EntryError[];
}

export function registerInstances(
	pi: ExtensionAPI,
	items: readonly RegistrationItem[],
): RegistrationOutcome {
	const registered: string[] = [];
	const failed: EntryError[] = [];
	for (const item of items) {
		try {
			pi.registerProvider(item.provider);
			registered.push(item.entry.name);
		} catch (error) {
			failed.push({
				name: item.entry.name,
				reason: `registration failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	return { registered, failed };
}
