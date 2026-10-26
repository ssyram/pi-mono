import type { HcSessionRecord } from "../subagents/hc-session-record.ts";

/** Display-only bridge into pi-subagents' Fleet overlay: publishes every HC
 * session (root + children) as an external run whose label carries the live
 * FSM frame facts. Registered through the extension's public
 * `pi-subagents.external-runs` API when present; absent silently in headless
 * or uninstalled hosts. */
export interface FsmFacts {
	readonly fsmName: string | undefined;
	readonly stateId: string | undefined;
	readonly noProgress: number;
}

interface ExternalRunInput {
	readonly id: string;
	readonly sessionId: string;
	readonly source: string;
	readonly label: string;
	readonly state: "queued" | "running" | "completed" | "failed" | "stopped";
	readonly startedAt: number;
	readonly updatedAt?: number | undefined;
	readonly endedAt?: number | undefined;
	readonly currentAction?: string | undefined;
	readonly transcriptPath?: string | undefined;
}

interface ExternalRunApi {
	registerExternalRun(input: ExternalRunInput): unknown;
	updateExternalRun(sessionId: string, id: string, update: Partial<Omit<ExternalRunInput, "id" | "sessionId" | "source">>): unknown;
	unregisterExternalRun(sessionId: string, id: string): boolean;
}

// Optional host integration: the module exists only where pi-subagents is
// installed; a dynamic import keeps hosts without it fully functional. Types
// come from src/types/pi-subagents-external-runs.d.ts.
async function loadApi(): Promise<ExternalRunApi | undefined> {
	try {
		return (await import("pi-subagents/external-runs")) as ExternalRunApi;
	} catch {
		return undefined;
	}
}

function externalStateOf(record: HcSessionRecord): ExternalRunInput["state"] {
	if (record.status === "busy" || record.status === "retry") return "running";
	if (record.lastOutcome?.kind === "failed") return "failed";
	if (record.lastOutcome?.kind === "cancelled") return "stopped";
	return "completed";
}

function labelOf(record: HcSessionRecord, facts: FsmFacts | undefined): string {
	const name = record.name ?? record.session_id.slice(0, 12);
	const frame = facts?.fsmName ? `${facts.fsmName}:${facts.stateId ?? "?"}${facts.noProgress > 0 ? ` ⏱${facts.noProgress}` : ""}` : "_default";
	return `${name} · ${frame}`;
}

const SOURCE = "fsm-compatible";

export class HcFleetExternalBridge {
	private readonly sessionId: string;
	private readonly idOf = (sid: string) => `hc-${sid}`;
	private readonly registered = new Map<string, ExternalRunInput["state"]>();
	private api: ExternalRunApi | undefined;
	private failed = false;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	/** Full reconcile from the session directory plus live FSM facts. */
	async sync(records: readonly HcSessionRecord[], factsOf: (sid: string) => FsmFacts | undefined, now = Date.now()): Promise<void> {
		if (this.failed) return;
		this.api ??= await loadApi();
		if (!this.failed && !this.api) {
			this.failed = true;
			return;
		}
		const api = this.api!;
		const live = new Set<string>();
		for (const record of records) {
			live.add(record.session_id);
			const input: ExternalRunInput = {
				id: this.idOf(record.session_id),
				sessionId: this.sessionId,
				source: SOURCE,
				label: labelOf(record, factsOf(record.session_id)),
				state: externalStateOf(record),
				startedAt: record.time_created,
				updatedAt: now,
				...(record.sessionFile ? { transcriptPath: record.sessionFile } : {}),
			};
			try {
				if (this.registered.has(record.session_id)) {
					api.updateExternalRun(this.sessionId, input.id, {
						label: input.label, state: input.state, updatedAt: input.updatedAt,
						...(input.transcriptPath ? { transcriptPath: input.transcriptPath } : {}),
					});
					this.registered.set(record.session_id, input.state);
				} else {
					api.registerExternalRun(input);
					this.registered.set(record.session_id, input.state);
				}
			} catch {
				/* a display-only mirror never blocks the runtime */
			}
		}
		for (const sid of [...this.registered.keys()]) {
			if (live.has(sid)) continue;
			try {
				api.unregisterExternalRun(this.sessionId, this.idOf(sid));
			} catch {
				/* best effort */
			}
			this.registered.delete(sid);
		}
	}

	async dispose(): Promise<void> {
		if (!this.api) return;
		for (const sid of this.registered.keys()) {
			try {
				this.api.unregisterExternalRun(this.sessionId, this.idOf(sid));
			} catch {
				/* best effort */
			}
		}
		this.registered.clear();
	}
}
