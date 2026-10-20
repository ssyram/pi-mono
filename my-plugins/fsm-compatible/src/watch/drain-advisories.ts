import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AdvisoryQueue } from "./advisory-queue.ts";

export interface DrainLookup {
	/** Real idle producer: the target session's isIdle()/waitForIdle() outcome. */
	isIdle(sessionId: string): boolean;
	/** True when the watcher custom message for this delivery is visible in the target's real branch. */
	consumed(deliveryId: string, sessionId: string): boolean;
}

/**
 * One drain pass: mark consumed entries first (real branch evidence), then
 * schedule accepted deliveries for idle targets via a turn-triggering custom
 * message. Never guesses consumption from model output.
 */
export function drainOnce(pi: ExtensionAPI, queue: AdvisoryQueue, lookup: DrainLookup): void {
	// Step P3: consumption evidence first, then scheduling for idle targets.
	for (const item of queue.snapshot()) {
		if (item.state === "scheduled" && lookup.consumed(item.deliveryId, item.targetSessionId)) {
			queue.markConsumed(item.deliveryId);
			continue;
		}
		if (item.state !== "accepted" || !lookup.isIdle(item.targetSessionId)) continue;
		try {
			pi.sendMessage({ customType: "fsm-compatible:watcher", content: item.text,
				details: { deliveryId: item.deliveryId }, display: true }, { triggerTurn: true });
			queue.markScheduled(item.deliveryId);
		} catch {
			queue.markFailed(item.deliveryId);
		}
	}
}
