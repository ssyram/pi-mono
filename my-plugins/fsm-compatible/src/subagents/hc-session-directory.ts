import type { RootBinding } from "../binding/actor-binding.ts";
import { HcAgentDomainError } from "./hc-agent-errors.ts";
import type { HcAgentSession } from "./hc-agent-types.ts";
import { restoreHcSessionRecord, snapshotHcSession, type HcSessionRecord, type HcSessionSnapshot } from "./hc-session-record.ts";

export const HC_SESSION_ENTRY = "fsm-compatible:hc-session";

/** Catalog of the owning runtime's HC sessions (one tree; the root record included). */
export class HcSessionDirectory {
	private readonly records = new Map<string, HcSessionRecord>();
	readonly root: RootBinding;

	constructor(root: RootBinding, snapshots: readonly HcSessionSnapshot[] = []) {
		this.root = root;
		// HC parity: a root session has no explicit agent, so its agent type is
		// defaultInfo()'s name (build) — prompt.ts falls back the same way when
		// inbox delivery resolves the sender agent of an agent-less session.
		// The root title mirrors the host's session title (HC sets it at root
		// creation; hosts may override via FSM_COMPATIBLE_ROOT_TITLE).
		this.records.set(root.rootSessionId, makeRootRecord(root, process.env.FSM_COMPATIBLE_ROOT_TITLE ?? "main", Date.now(), "build"));
		for (const snapshot of snapshots) {
			const record = restoreHcSessionRecord(snapshot);
			if (record.binding.rootSessionId !== root.rootSessionId) throw new Error("hc session snapshot root mismatch");
			this.records.set(record.session_id, record);
		}
	}

	get(sessionId: string): HcSessionRecord {
		const record = this.records.get(sessionId);
		if (!record) throw HcAgentDomainError.agentNotFound(sessionId);
		return record;
	}

	find(sessionId: string): HcSessionRecord | undefined {
		return this.records.get(sessionId);
	}

	list(): HcSessionRecord[] {
		return [...this.records.values()];
	}

	/** Persist the identity facts first, then register: the caller passes the real appendEntry side effect. */
	putCreated(record: HcSessionRecord, persist: (snapshot: HcSessionSnapshot) => void): void {
		if (this.records.has(record.session_id)) throw new Error("hc session id already registered");
		if (record.binding.rootSessionId !== this.root.rootSessionId) throw new Error("hc session root mismatch");
		if (record.parent_id !== undefined && !this.records.has(record.parent_id)) {
			throw HcAgentDomainError.agentNotFound(record.parent_id);
		}
		persist(snapshotHcSession(record));
		this.records.set(record.session_id, record);
	}

	/** Target identity for delivery: the target's own agent/model/variant, never the sender's. */
	readTargetIdentity(sessionId: string): { agent_type: string | undefined; model: HcSessionRecord["model"]; variant: string } {
		const record = this.get(sessionId);
		return { agent_type: record.agent_type, model: record.model, variant: record.variant };
	}

	/** Owning runtime of a session; this directory's runtime owns its whole tree. */
	locateOwner(sessionId: string): string | undefined {
		return this.records.has(sessionId) ? this.root.rootSessionId : undefined;
	}

	/** Protocol sid of the session a tool call is executing in, by host id. */
	protocolIdOf(hostSessionId: string): string | undefined {
		if (hostSessionId === this.root.sessionId) return this.root.rootSessionId;
		for (const record of this.records.values()) {
			if (record.hostSessionId === hostSessionId) return record.session_id;
		}
		return undefined;
	}

	descendants(parentId: string): HcSessionRecord[] {
		return this.list().filter((record) => record.parent_id === parentId)
			.flatMap((record) => [record, ...this.descendants(record.session_id)]);
	}

	children(parentId: string): HcSessionRecord[] {
		return this.list().filter((record) => record.parent_id === parentId);
	}

	/** Shared projection for the HC pure tree functions (test-contract §1 shape). */
	toAgentSessions(): HcAgentSession[] {
		return this.list().map((record) => ({
			session_id: record.session_id,
			parent_id: record.parent_id,
			name: record.name,
			agent_type: record.agent_type,
			title: record.title,
			time_created: record.time_created,
			workdir: record.workdir,
			status: record.status,
		}));
	}
}

/** Root record: depth 0, no parent; present in every directory so neighborhoods can address it. */
export function makeRootRecord(root: RootBinding, title: string, timeCreated: number, agentType?: string): HcSessionRecord {
	return {
		session_id: root.rootSessionId,
		parent_id: undefined,
		name: undefined,
		agent_type: agentType,
		title,
		time_created: timeCreated,
		workdir: undefined,
		binding: root,
		model: { providerID: "", modelID: "" },
		variant: "default",
		description: title,
		notify: false,
		depth: 0,
		sessionFile: "",
		hostSessionId: undefined,
		handle: undefined,
		status: "idle",
		lastRunMessages: undefined,
		lastOutcome: undefined,
	};
}

/** Parse persisted HC session entries from a real session branch (restore path). */
export function readHcSessionSnapshots(entries: readonly { type: string; customType?: string; data?: unknown }[]): HcSessionSnapshot[] {
	const snapshots: HcSessionSnapshot[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== HC_SESSION_ENTRY) continue;
		const data = entry.data as HcSessionSnapshot | undefined;
		if (!data || typeof data.session_id !== "string" || typeof data.sessionFile !== "string") continue;
		snapshots.push(data);
	}
	return snapshots;
}
