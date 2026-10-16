import type { BoulderInhibitionSnapshot } from "./protocol.ts";
import { describeThrown } from "./describe-error.ts";
import type { BoulderInhibitionClient, BoulderInhibitionFailure } from "./service-protocol.ts";

export interface LoopInhibitionProgress {
	status: "active" | "completed" | "expired";
}

export interface LoopInhibitionRegistration {
	id: string;
	reference: { scope: "workspace" | "global"; definitionId: string };
	registeredAt: number;
	progress: LoopInhibitionProgress;
}

export interface LoopInhibitionState {
	tasks: readonly {
		definition: { inhibitBoulder?: boolean };
		progress: LoopInhibitionProgress;
	}[];
	registrations: readonly LoopInhibitionRegistration[];
}

export type LoopRegistrationResolution =
	| { kind: "resolved"; inhibitBoulder: boolean }
	| { kind: "missing" }
	| { kind: "unavailable" };

export type LoopRegistrationResolver = (registration: LoopInhibitionRegistration) => LoopRegistrationResolution;

export type LoopInhibitionSyncResult =
	| { ok: true; written: boolean; snapshot: BoulderInhibitionSnapshot }
	| { ok: false; failure: BoulderInhibitionFailure };

export function hasSpecialLoopSchedules(
	state: LoopInhibitionState,
	resolveRegistration: LoopRegistrationResolver,
): boolean {
	for (const task of state.tasks) {
		if (task.progress.status === "active" && task.definition.inhibitBoulder === true) return true;
	}
	for (const registration of state.registrations) {
		if (registration.progress.status !== "active") continue;
		const resolved = resolveRegistration(registration);
		if (resolved.kind === "unavailable") {
			throw new Error(`Cannot resolve active loop registration: ${registration.id}`);
		}
		if (resolved.kind === "resolved" && resolved.inhibitBoulder) return true;
	}
	return false;
}

export function syncLoopBoulderInhibition(
	state: LoopInhibitionState,
	resolveRegistration: LoopRegistrationResolver,
	client: BoulderInhibitionClient,
): LoopInhibitionSyncResult {
	try {
		const value = hasSpecialLoopSchedules(state, resolveRegistration);
		const read = client.get();
		if (!read.ok) return { ok: false, failure: read.failure };
		const current = read.snapshot.states.find((signal) => signal.type === "loop");
		if (current?.value === value) return { ok: true, written: false, snapshot: read.snapshot };
		const written = client.set({ type: "loop", value });
		return written.ok
			? { ok: true, written: true, snapshot: written.snapshot }
			: { ok: false, failure: written.failure };
	} catch (error) {
		return { ok: false, failure: { message: describeThrown(error), cause: error } };
	}
}
