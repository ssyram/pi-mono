import { formatBoulderInhibition } from "./format-inhibition.ts";
import {
	BOULDER_INHIBIT_ENTRY_TYPE,
	type BoulderInhibitSignal,
	type BoulderInhibitionEffects,
	type BoulderInhibitionPort,
	type BoulderInhibitionSnapshot,
} from "./protocol.ts";
import { readBoulderInhibition } from "./read-inhibition.ts";

export function writeBoulderInhibition(
	port: BoulderInhibitionPort,
	effects: BoulderInhibitionEffects,
	signal: BoulderInhibitSignal,
): BoulderInhibitionSnapshot {
	port.appendEntry(BOULDER_INHIBIT_ENTRY_TYPE, { type: signal.type, value: signal.value });
	const snapshot = readBoulderInhibition(port.getBranch());
	if (snapshot.inhibited) effects.cancelWait();
	effects.reportInfo(`Boulder signal ${signal.type}=${signal.value}; ${formatBoulderInhibition(snapshot)}`);
	return snapshot;
}
