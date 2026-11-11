/**
 * Persistent command output: appended as a custom session entry and rendered
 * as a chat block (the omp-v2 task-system pattern), so it is never
 * overwritten by later info notifications.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export const USAGE_OUTPUT_ENTRY_TYPE = "provider-usage-command-output";
export interface UsageOutputEntryData {
	tone: "info" | "warning";
	text: string;
}

interface EntryRendererApi {
	registerEntryRenderer<T>(
		customType: string,
		renderer: (
			entry: { data?: T },
			options: { expanded: boolean },
			theme: { fg(color: string, text: string): string },
		) => Text | undefined,
	): void;
}

/** `pi` is the host ExtensionAPI; typed loosely because the plugin keeps a
 * narrow PiExtensionAPI contract. */
export function registerUsageOutputEntryRenderer(pi: object): void {
	const rendererApi = pi as ExtensionAPI & EntryRendererApi;
	rendererApi.registerEntryRenderer<UsageOutputEntryData>(USAGE_OUTPUT_ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (!data) return undefined;
		const text = data.tone === "warning" ? theme.fg("warning", data.text) : data.text;
		return new Text(text, 0, 0);
	});
}
