import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ChildBinding, PersistedBinding } from "../binding/actor-binding.ts";
import type { HcAgentModel, HcAgentWorkdir } from "./hc-agent-types.ts";
import type { ChildSession } from "./hc-nico-factory.ts";

export type HcSessionRunStatus = "busy" | "retry" | "idle";

export interface HcRunOutcomeFact {
	readonly kind: "completed" | "failed" | "cancelled";
	readonly text: string;
	readonly summary: string;
}

/** Runtime record of one HC session: identity facts are established before the first background run. */
export interface HcSessionRecord {
	readonly session_id: string;
	readonly parent_id: string | undefined;
	readonly name: string | undefined;
	readonly agent_type: string | undefined;
	readonly title: string;
	readonly time_created: number;
	readonly workdir: HcAgentWorkdir | undefined;
	readonly binding: PersistedBinding;
	readonly model: HcAgentModel;
	/** Persisted model variant; "default" is the stored form, undefined at delivery (HC lifecycle.ts:359-372). */
	readonly variant: string;
	readonly description: string;
	readonly notify: boolean;
	readonly depth: number;
	/** Real SDK session file backing this HC session. */
	readonly sessionFile: string;
	hostSessionId: string | undefined;
	handle: ChildSession | undefined;
	status: HcSessionRunStatus;
	/** Messages of the last finished run; runtime fact, never persisted. */
	lastRunMessages: readonly AgentMessage[] | undefined;
	lastOutcome: HcRunOutcomeFact | undefined;
	/** Runtime-only: agent profile of the current turn's wake origin ("build" after a Stop continuation). Not persisted. */
	turnProfile?: string;
}

/** JSON snapshot persisted into the owning root session before the first background run. */
export interface HcSessionSnapshot {
	readonly session_id: string;
	readonly parent_id: string;
	readonly name: string | null;
	readonly agent_type: string;
	readonly title: string;
	readonly time_created: number;
	readonly workdir: HcAgentWorkdir | null;
	readonly binding: PersistedBinding;
	readonly model: HcAgentModel;
	readonly variant: string;
	readonly description: string;
	readonly notify: boolean;
	readonly depth: number;
	readonly sessionFile: string;
	readonly hostSessionId: string | null;
}

export function snapshotHcSession(record: HcSessionRecord): HcSessionSnapshot {
	return {
		session_id: record.session_id,
		parent_id: record.parent_id ?? "",
		name: record.name ?? null,
		agent_type: record.agent_type ?? "",
		title: record.title,
		time_created: record.time_created,
		workdir: record.workdir ?? null,
		binding: record.binding,
		model: record.model,
		variant: record.variant,
		description: record.description,
		notify: record.notify,
		depth: record.depth,
		sessionFile: record.sessionFile,
		hostSessionId: record.hostSessionId ?? null,
	};
}

export function restoreHcSessionRecord(snapshot: HcSessionSnapshot): HcSessionRecord {
	if (snapshot.binding.sessionId !== snapshot.session_id) throw new Error("hc session snapshot identity mismatch");
	return {
		session_id: snapshot.session_id,
		parent_id: snapshot.parent_id || undefined,
		name: snapshot.name ?? undefined,
		agent_type: snapshot.agent_type || undefined,
		title: snapshot.title,
		time_created: snapshot.time_created,
		workdir: snapshot.workdir ?? undefined,
		binding: snapshot.binding,
		model: snapshot.model,
		variant: snapshot.variant,
		description: snapshot.description,
		notify: snapshot.notify,
		depth: snapshot.depth,
		sessionFile: snapshot.sessionFile,
		hostSessionId: snapshot.hostSessionId ?? undefined,
		handle: undefined,
		status: "idle",
		lastRunMessages: undefined,
		lastOutcome: undefined,
	};
}
