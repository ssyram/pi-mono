import type { BoulderInhibitionSnapshot } from "./protocol.ts";

export function formatBoulderInhibition(snapshot: BoulderInhibitionSnapshot): string {
	return snapshot.inhibited ? `Boulder inhibited: ${snapshot.blockers.join(", ")}` : "Boulder inhibition clear";
}
