import type { SessionEntry } from "@mariozechner/pi-coding-agent";

/**
 * Walk branch entries backwards, counting user turns (or assistant turns if assistantCut).
 * Returns the entry ID of the first entry to keep, or null if there aren't enough turns.
 */
export function findFirstKeptEntryId(
	branchEntries: SessionEntry[],
	keepCount: number,
	assistantCut: boolean,
): string | null {
	let turnsFound = 0;
	// Walk backwards to find the cut point
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry.type !== "message") continue;

		const role = entry.message.role;
		const isCountedRole = assistantCut ? role === "assistant" : role === "user";

		if (isCountedRole) {
			turnsFound++;
			if (turnsFound === keepCount) {
				return entry.id;
			}
		}
	}

	return null; // not enough turns to compact
}
