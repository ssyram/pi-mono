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

/** Task/registration ids whose live runs must keep the loop signal up. */
export function inhibitingIdsFromSnapshot(
	snapshot: {
		tasks: readonly { definition: { id: string; inhibitBoulder?: boolean } }[];
		registrations: readonly { id: string }[];
	},
	resolveRegistration: (id: string) =>
		| { kind: "resolved"; inhibitBoulder: boolean }
		| { kind: "missing" }
		| { kind: "unavailable" },
): Set<string> {
	const inhibiting = new Set(
		snapshot.tasks
			.filter((task) => task.definition.inhibitBoulder === true)
			.map((task) => task.definition.id),
	);
	for (const registration of snapshot.registrations) {
		const resolved = resolveRegistration(registration.id);
		if (resolved.kind === "resolved" && resolved.inhibitBoulder)
			inhibiting.add(registration.id);
	}
	return inhibiting;
}

export function createBoulderSync(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	core: LoopV2Core,
	options?: { liveInhibitingRun?: () => boolean },
): BoulderSyncBridge {
	const client = createBoulderInhibitionClient(pi.events, ctx.sessionManager);
	return {
		sync() {
			try {
				const snapshot = core.snapshotSessionState();
				// A one-shot completes its schedule at dispatch, but its run lives
				// until delivery; inhibition must span that whole window.
				const runHeld = options?.liveInhibitingRun?.() === true;
				const result = syncLoopBoulderInhibition(
					{
						tasks: [
							...snapshot.tasks.map((task) => ({
								definition: task.definition,
								progress: { status: task.progress.status },
							})),
							...(runHeld
								? [
										{
											definition: {
												inhibitBoulder: true,
											},
											progress: { status: "active" as const },
										},
									]
								: []),
						],
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
