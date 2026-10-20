import { RuntimeError } from "../runtime/runtime-error.ts";
import type { RecordStore } from "./record-store.ts";
import { normalizeIsoTimestamp } from "./record-time.ts";
import type { ExecutionRecord } from "./session-record.ts";

export interface OcSession {
	readonly id: string;
	readonly parentID: string | null;
	readonly title: string;
	readonly time: { readonly created: number; readonly updated: number };
}
export type OcStatusType = "busy" | "retry" | "idle";
export interface OcStatus { readonly type: OcStatusType }

function sessionOf(record: ExecutionRecord): OcSession {
	// Step P1: created comes from the real persisted header when it exists.
	const created = record.header ? normalizeIsoTimestamp(record.header.timestamp) : record.updatedAt;
	return { id: record.sessionId, parentID: record.parentSessionId, title: record.title,
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
		if (record) sessions.push(sessionOf(record));
		const children = store.executionChildren(current)
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
	for (const record of store.listExecutions()) {
		statuses.set(record.sessionId, { type: lifecycleStatus(record.lifecycle) });
	}
	for (const judge of store.listJudges()) {
		if (judge.lifecycle === "unavailable") throw new RuntimeError("not-ready");
		statuses.set(judge.sessionId, { type: judge.lifecycle === "busy" ? "busy" : "idle" });
	}
	return statuses;
}
