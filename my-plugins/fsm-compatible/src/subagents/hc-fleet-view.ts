import type { HcAgentRuntimeServices } from "./hc-agent-services.ts";
import type { HcSessionRecord } from "./hc-session-record.ts";
import type { SessionLifecycle } from "../records/session-record.ts";

export interface FleetChildView {
	readonly sessionId: string;
	readonly parentSessionId: string | null;
	readonly name: string | null;
	readonly model: string;
	readonly thinking: string;
	readonly lifecycle: SessionLifecycle;
	readonly outcome: string | null;
	readonly runActive: boolean;
	readonly sessionFile: string;
	readonly cwd: string;
	readonly depth: number;
}

export interface FleetView {
	list(): readonly FleetChildView[];
	subscribe(listener: (sessionId: string, event: Record<string, unknown>) => void): () => void;
	send(target: string, message: string): Promise<void>;
}

function lifecycleOf(record: HcSessionRecord): SessionLifecycle {
	if (record.status === "busy") return "running";
	if (record.status === "retry") return "retrying";
	return record.lastOutcome?.kind === "failed" ? "failed" : "idle";
}

function toView(services: HcAgentRuntimeServices, record: HcSessionRecord): FleetChildView {
	return {
		sessionId: record.session_id,
		parentSessionId: record.parent_id ?? null,
		name: record.name ?? null,
		model: `${record.model.providerID}/${record.model.modelID}`,
		thinking: record.variant,
		lifecycle: lifecycleOf(record),
		outcome: record.lastOutcome ? record.lastOutcome.kind : null,
		runActive: record.status !== "idle",
		sessionFile: record.sessionFile,
		cwd: record.workdir?.path ?? services.instanceDirectory,
		depth: record.depth,
	};
}

/** Read-only projection of the HC session facts for the above-editor widget. */
export function hcFleetView(services: HcAgentRuntimeServices, events: Set<(sessionId: string, event: Record<string, unknown>) => void>): FleetView {
	return {
		list: () => services.directory
			.list()
			.filter((record) => record.session_id !== services.root.rootSessionId)
			.map((record) => toView(services, record)),
		subscribe: (listener) => {
			events.add(listener);
			return () => events.delete(listener);
		},
		send: async (target, message) => {
			const record = services.directory.get(target);
			await services.deliverMessage({
				target: record.session_id,
				sender: services.root.rootSessionId,
				sender_name: services.directory.get(services.root.rootSessionId).name,
				sender_agent: undefined,
				body: message,
			});
		},
	};
}
