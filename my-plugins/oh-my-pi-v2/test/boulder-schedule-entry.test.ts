import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	appendBoulderScheduleEntry,
	BOULDER_SCHEDULE_ENTRY_TYPE,
	registerBoulderScheduleEntryRenderer,
	type BoulderScheduleEntryData,
} from "../hooks/boulder-schedule-entry.js";

type ScheduleRenderer = (
	entry: { data?: BoulderScheduleEntryData },
	options: { expanded: boolean },
	theme: { fg(color: string, text: string): string },
) => Text | undefined;

it("records and renders an AI-invisible Boulder schedule entry", () => {
	const entries: Array<{ customType: string; data: BoulderScheduleEntryData }> = [];
	let renderer: ScheduleRenderer | undefined;
	const pi = {
		appendEntry: (customType: string, data: BoulderScheduleEntryData) => entries.push({ customType, data }),
		registerEntryRenderer: (_customType: string, entryRenderer: ScheduleRenderer) => {
			renderer = entryRenderer;
		},
	} as unknown as ExtensionAPI;
	const data = { attempt: 4, maxAttempts: 10, scheduledDelayMs: 20_000 };

	appendBoulderScheduleEntry(pi, data);
	registerBoulderScheduleEntryRenderer(pi);

	assert.deepEqual(entries, [{ customType: BOULDER_SCHEDULE_ENTRY_TYPE, data }]);
	const component = renderer?.({ data }, { expanded: false }, { fg: (_color, text) => text });
	assert.equal(
		component?.render(100).join("\n").trimEnd(),
		"↻ Automatic Boulder 4/10 resume scheduled, restarting in 20s",
	);
});
