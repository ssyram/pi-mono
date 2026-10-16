export const BOULDER_INHIBIT_ENTRY_TYPE = "OMPv2InhibitBoulder";

export interface BoulderInhibitSignal {
	type: string;
	value: boolean;
}

export interface BoulderEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

export interface BoulderInhibitionSnapshot {
	states: BoulderInhibitSignal[];
	blockers: string[];
	inhibited: boolean;
}

export interface BoulderBranchReader {
	getBranch(): readonly BoulderEntryLike[];
}

export interface BoulderInhibitionPort extends BoulderBranchReader {
	appendEntry(customType: string, data: BoulderInhibitSignal): void;
}

export interface BoulderInhibitionEffects {
	cancelWait(): void;
	reportInfo(text: string): void;
}
