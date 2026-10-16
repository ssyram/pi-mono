import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { snapshotBackgroundWork } from "../../../third-party-plugins/pi-subagents/src/api/background-work.js";
import { listAsyncRuns } from "../../../third-party-plugins/pi-subagents/src/runs/background/async-status.js";
import { DIRS } from "../../../third-party-plugins/pi-subagents/src/shared/types.js";

const ACTIVE_ASYNC_STATES = ["queued", "running"] as const;

export interface BoulderBackgroundWork {
	isActive(context: ExtensionContext): boolean;
}

export type BoulderLiveWorkReader = (sessionId: string) => boolean;

export function createBoulderBackgroundWork(
	readLiveWork: BoulderLiveWorkReader = hasLiveBackgroundWork,
): BoulderBackgroundWork {
	return {
		isActive(context) {
			const sessionId =
				context.sessionManager.getSessionFile() ??
				context.sessionManager.getSessionId();
			return sessionId ? readLiveWork(sessionId) : false;
		},
	};
}

function hasLiveBackgroundWork(sessionId: string): boolean {
	return (
		listAsyncRuns(DIRS.async, {
			states: [...ACTIVE_ASYNC_STATES],
			sessionId,
			resultsDir: DIRS.results,
		}).length > 0 || snapshotBackgroundWork(sessionId).items.length > 0
	);
}
