import type { RecordStore } from "../records/record-store.ts";
import type { SessionLifecycle } from "../records/session-record.ts";
import type { HcSessionRecord } from "./hc-session-record.ts";

function lifecycleOf(record: HcSessionRecord): SessionLifecycle {
	if (record.status === "busy") return "running";
	if (record.status === "retry") return "retrying";
	return record.lastOutcome?.kind === "failed" ? "failed" : "idle";
}

/**
 * Project a session's facts into the shared record store. Children publish a
 * header under their HC protocol sid carrying their real creation time and
 * workdir: every field is a real fact of the child, registered under the name
 * FSM addresses it by.
 */
export function publishHcExecution(store: RecordStore, record: HcSessionRecord, instanceDirectory: string): void {
	if (record.binding.kind !== "execution-child") return;
	store.publishExecution(record.binding, {
		title: record.title,
		lifecycle: lifecycleOf(record),
		updatedAt: Date.now(),
		header: {
			type: "session",
			version: 3,
			id: record.session_id,
			timestamp: new Date(record.time_created).toISOString(),
			cwd: record.workdir?.path ?? instanceDirectory,
		},
		branch: [],
		sessionFile: record.sessionFile,
		errorMessage: record.lastOutcome?.kind === "failed" ? record.lastOutcome.text : null,
	});
}
