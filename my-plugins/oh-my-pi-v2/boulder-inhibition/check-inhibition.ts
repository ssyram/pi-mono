import { formatBoulderInhibition } from "./format-inhibition.ts";
import type { BoulderBranchReader, BoulderInhibitionSnapshot } from "./protocol.ts";
import { readBoulderInhibition } from "./read-inhibition.ts";

export function checkBoulderInhibition(
	reader: BoulderBranchReader,
	reportInfo: (text: string) => void,
): BoulderInhibitionSnapshot {
	const snapshot = readBoulderInhibition(reader.getBranch());
	reportInfo(formatBoulderInhibition(snapshot));
	return snapshot;
}
