import { RuntimeError } from "../runtime/runtime-error.ts";
import type { RecordStore } from "./record-store.ts";
import { normalizeIsoTimestamp } from "./record-time.ts";
import type { ExecutionRecord } from "./session-record.ts";

export interface OcSession {
	readonly id: string;
	readonly parentID?: string | null;
	readonly title: string;
	readonly agent?: string;
	readonly name?: string;
	readonly time: { readonly created: number; readonly updated: number };
}
export type OcStatusType = "busy" | "retry" | "idle";
export interface OcStatus { readonly type: OcStatusType }

function sessionOf(record: ExecutionRecord, rootHostId: string, rootProtocolId: string): OcSession {
	// Step P1: created comes from the real persisted header when it exists.
	const created = record.header ? normalizeIsoTimestamp(record.header.timestamp) : record.updatedAt;
	const id = record.sessionId === rootHostId ? rootProtocolId : record.sessionId;
	const parentID = record.parentSessionId === rootHostId ? rootProtocolId : record.parentSessionId;
	// HC stores the execution profile on the session: the root carries the host
	// default profile, children carry their spawn type (agentId holds it).
	// A root session omits parentID entirely — HC distinguishes absent from
	// null on this wire.
	return { id, ...(parentID === null ? {} : { parentID }), title: record.title,
		agent: record.sessionId === rootHostId ? "build" : (record.agentName ?? record.agentId),
		...(record.agentDisplayName ? { name: record.agentDisplayName } : {}),
		time: { created, updated: record.updatedAt } };
}

function lifecycleStatus(lifecycle: ExecutionRecord["lifecycle"]): OcStatusType {
	if (lifecycle === "starting" || lifecycle === "running" || lifecycle === "settling") return "busy";
	if (lifecycle === "retrying") return "retry";
	if (lifecycle === "idle" || lifecycle === "failed" || lifecycle === "aborted") return "idle";
	throw new RuntimeError("not-ready");
}

export function projectOcRoster(store: RecordStore): readonly OcSession[] {
	const sessions: OcSession[] = [];
	const seen = new Set<string>();
	const queue: string[] = [store.rootId];
	while (queue.length) {
		const current = queue.shift();
		if (!current || seen.has(current)) throw new RuntimeError("protocol-invalid");
		seen.add(current);
		const record = store.getExecution(current);
		if (record) sessions.push(sessionOf(record, store.rootId, store.rootProtocolId));
		// Children record the root's protocol sid as parent, while the BFS
		// starts at the host root id: match both spellings at the root layer.
		const children = [...store.executionChildren(current), ...(current === store.rootId ? store.executionChildren(store.rootProtocolId) : [])]
			.map((child) => child.sessionId)
			.sort((left, right) => (left < right ? -1 : 1));
		queue.push(...children);
	}
	for (const judge of store.listJudges()) {
		sessions.push({ id: judge.sessionId, parentID: null, title: judge.title,
			time: { created: judge.createdAt, updated: judge.updatedAt } });
	}
	return sessions;
}

export function projectOcStatuses(store: RecordStore): ReadonlyMap<string, OcStatus> {
	const statuses = new Map<string, OcStatus>();
	// OC's /session/status lists only sessions with active runs; idle sessions
	// are absent from the map, and observers treat absence as idle.
	for (const record of store.listExecutions()) {
		const status = lifecycleStatus(record.lifecycle);
		if (status === "idle") continue;
		const id = record.sessionId === store.rootId ? store.rootProtocolId : record.sessionId;
		statuses.set(id, { type: status });
	}
	for (const judge of store.listJudges()) {
		if (judge.lifecycle === "unavailable") throw new RuntimeError("not-ready");
		statuses.set(judge.sessionId, { type: judge.lifecycle === "busy" ? "busy" : "idle" });
	}
	return statuses;
}
