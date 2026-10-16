import type {
	BoulderEntryLike,
	BoulderInhibitionPort,
	BoulderInhibitSignal,
} from "../../boulder-inhibition/protocol.ts";

export function signalEntry(type: string, value: boolean): BoulderEntryLike {
	return { type: "custom", customType: "OMPv2InhibitBoulder", data: { type, value } };
}

export class InMemoryBranch implements BoulderInhibitionPort {
	entries: BoulderEntryLike[];
	readonly events: string[] = [];

	constructor(entries: readonly BoulderEntryLike[] = []) {
		this.entries = [...entries];
	}

	appendEntry(customType: string, data: BoulderInhibitSignal): void {
		this.events.push("appendEntry");
		this.entries.push({ type: "custom", customType, data });
	}

	getBranch(): readonly BoulderEntryLike[] {
		this.events.push("getBranch");
		return [...this.entries];
	}
}
