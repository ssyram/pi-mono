import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { describeThrown } from "../boulder-inhibition/describe-error.js";
import { reportBoulderDiagnostic } from "../boulder-inhibition/report-error.js";

export const BOULDER_INFO_ENTRY_TYPE = "omp-boulder-inhibition-info";

export interface BoulderInfoEntryData {
	tone: "info" | "warning";
	text: string;
}

interface BoulderInfoRendererApi {
	registerEntryRenderer<T>(
		customType: string,
		renderer: (
			entry: { data?: T },
			options: { expanded: boolean },
			theme: { fg(color: string, text: string): string },
		) => Text | undefined,
	): void;
}

export function appendBoulderInfoEntry(pi: ExtensionAPI, data: BoulderInfoEntryData): void {
	pi.appendEntry<BoulderInfoEntryData>(BOULDER_INFO_ENTRY_TYPE, data);
}

export function registerBoulderInfoEntryRenderer(pi: ExtensionAPI): void {
	const rendererApi = pi as ExtensionAPI & BoulderInfoRendererApi;
	rendererApi.registerEntryRenderer<BoulderInfoEntryData>(BOULDER_INFO_ENTRY_TYPE, (entry, _options, theme) => {
		try {
			const data = entry.data;
			if (!data) return undefined;
			const text = data.tone === "warning" ? theme.fg("warning", data.text) : data.text;
			return new Text(text, 0, 0);
		} catch (error) {
			reportBoulderDiagnostic(`[oh-my-pi boulder] Rendering failed: ${describeThrown(error)}`);
			return undefined;
		}
	});
}
