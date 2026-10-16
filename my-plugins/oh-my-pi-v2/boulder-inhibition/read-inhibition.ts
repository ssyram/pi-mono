import { parseBoulderInhibitSignal } from "./parse-signal.ts";
import {
	BOULDER_INHIBIT_ENTRY_TYPE,
	type BoulderEntryLike,
	type BoulderInhibitionSnapshot,
	type BoulderInhibitSignal,
} from "./protocol.ts";

export function readBoulderInhibition(
	entries: readonly BoulderEntryLike[],
): BoulderInhibitionSnapshot {
	const latest = new Map<string, BoulderInhibitSignal>();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (
			entry === undefined ||
			entry.type !== "custom" ||
			entry.customType !== BOULDER_INHIBIT_ENTRY_TYPE
		)
			continue;
		const signal = parseBoulderInhibitSignal(entry.data);
		if (signal === undefined || latest.has(signal.type)) continue;
		latest.set(signal.type, signal);
	}
	const states = [...latest.values()];
	const blockers = states
		.filter((signal) => signal.value)
		.map((signal) => signal.type);
	return { states, blockers, inhibited: blockers.length > 0 };
}
