import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatBoulderDelay } from "./boulder-retry-policy.js";

export const BOULDER_SCHEDULE_ENTRY_TYPE = "omp-boulder-schedule";

export interface BoulderScheduleEntryData {
	attempt: number;
	maxAttempts: number;
	scheduledDelayMs: number;
}

interface ScheduleEntryRendererApi {
	registerEntryRenderer<T>(
		customType: string,
		renderer: (
			entry: { data?: T },
			options: { expanded: boolean },
			theme: { fg(color: string, text: string): string },
		) => Text | undefined,
	): void;
}

export function appendBoulderScheduleEntry(
	pi: ExtensionAPI,
	data: BoulderScheduleEntryData,
): void {
	pi.appendEntry<BoulderScheduleEntryData>(BOULDER_SCHEDULE_ENTRY_TYPE, data);
}

export function registerBoulderScheduleEntryRenderer(pi: ExtensionAPI): void {
	const rendererApi = pi as ExtensionAPI & ScheduleEntryRendererApi;
	rendererApi.registerEntryRenderer<BoulderScheduleEntryData>(BOULDER_SCHEDULE_ENTRY_TYPE, (entry, _options, theme) => {
		if (!entry.data) return undefined;
		const { attempt, maxAttempts, scheduledDelayMs } = entry.data;
		return new Text(
			theme.fg(
				"accent",
				`↻ Automatic Boulder ${attempt}/${maxAttempts} resume scheduled, restarting in ${formatBoulderDelay(scheduledDelayMs)}`,
			),
			0,
			0,
		);
	});
}
