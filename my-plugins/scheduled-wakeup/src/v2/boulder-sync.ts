import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describeThrown } from "../../../oh-my-pi-v2/boulder-inhibition/describe-error.js";
import { syncLoopBoulderInhibition } from "../../../oh-my-pi-v2/boulder-inhibition/loop-inhibition.js";
import { reportBoulderDiagnostic } from "../../../oh-my-pi-v2/boulder-inhibition/report-error.js";
import { createBoulderInhibitionClient } from "../../../oh-my-pi-v2/boulder-inhibition/service-client.js";
import type { LoopV2Core } from "./loop-core.js";

/**
 * Bridge between the loop runtime and the OMP inhibition service.
 * Recomputes the aggregate from the live session state and syncs the
 * "loop" signal through the shared bus service. All failures become
 * console diagnostics; nothing escapes into Pi event handlers.
 */
export interface BoulderSyncBridge {
	sync(): void;
}

export function createBoulderSync(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	core: LoopV2Core,
): BoulderSyncBridge {
	const client = createBoulderInhibitionClient(pi.events, ctx.sessionManager);
	return {
		sync() {
			try {
				const snapshot = core.snapshotSessionState();
				const result = syncLoopBoulderInhibition(
					{
						tasks: snapshot.tasks.map((task) => ({
							definition: task.definition,
							progress: { status: task.progress.status },
						})),
						registrations: snapshot.registrations.map((registration) => ({
							id: registration.id,
							reference: { ...registration.reference },
							registeredAt: registration.registeredAt,
							progress: { status: registration.progress.status },
						})),
					},
					(registration) => core.registrationInhibition(registration.id),
					client,
				);
				if (!result.ok) {
					reportBoulderDiagnostic(
						`[scheduled-wakeup boulder] sync failed: ${result.failure.message}`,
					);
				}
			} catch (error) {
				reportBoulderDiagnostic(
					`[scheduled-wakeup boulder] sync error: ${describeThrown(error)}`,
				);
			}
		},
	};
}
