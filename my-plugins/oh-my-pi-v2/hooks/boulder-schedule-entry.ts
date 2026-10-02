import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { ClickExpandText, clickExpandable } from "../tools/click-expand.js";
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
			entry: { data?: T; id?: number | string },
			options: { expanded: boolean },
			theme: { fg(color: string, text: string): string },
		) => Component | undefined,
	): void;
}

export function appendBoulderScheduleEntry(pi: ExtensionAPI, data: BoulderScheduleEntryData): void {
	pi.appendEntry<BoulderScheduleEntryData>(BOULDER_SCHEDULE_ENTRY_TYPE, data);
}

export function registerBoulderScheduleEntryRenderer(pi: ExtensionAPI): void {
	const rendererApi = pi as ExtensionAPI & ScheduleEntryRendererApi;
	rendererApi.registerEntryRenderer<BoulderScheduleEntryData>(BOULDER_SCHEDULE_ENTRY_TYPE, (entry, _options, theme) => {
		if (!entry.data) return undefined;
		// Click-to-expand needs the fullscreen TUI mouse path; the wrapper is a
		// rendering no-op in regular mode, so no mode check is needed.
		try {
			const { attempt, maxAttempts, scheduledDelayMs } = entry.data;
			const label = `↻ Automatic Boulder ${attempt}/${maxAttempts} resume scheduled, restarting in ${formatBoulderDelay(scheduledDelayMs)}`;
			const key = `boulder-schedule:${entry.id ?? "single"}`;
			return clickExpandable(
				new ClickExpandText({
					key,
					collapsed: () => theme.fg("accent", label) + theme.fg("dim", " (click to expand)"),
					expanded: () =>
						theme.fg("accent", label) +
						theme.fg("dim", " (click to collapse)") +
						`\n${theme.fg("muted", `  attempt ${attempt}/${maxAttempts} · delay ${formatBoulderDelay(scheduledDelayMs)}`)}` +
						`\n${theme.fg("muted", "  On timer, Boulder sends an automatic resume message listing open tasks to continue work.")}`,
				}),
				key,
			);
		} catch {
			return new Text(
				theme.fg("accent", `↻ Automatic Boulder ${entry.data.attempt}/${entry.data.maxAttempts} resume scheduled`),
				0,
				0,
			);
		}
	});
}
