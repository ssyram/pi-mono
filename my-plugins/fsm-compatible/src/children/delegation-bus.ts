export interface EventSurface {
	emit(event: string, payload: unknown): void;
	on(event: string, handler: (payload: unknown) => void): () => void;
}

export const DELEGATION_REQUEST_EVENT = "prompt-template:subagent:request";
export const DELEGATION_STARTED_EVENT = "prompt-template:subagent:started";
export const DELEGATION_UPDATE_EVENT = "prompt-template:subagent:update";
export const DELEGATION_RESPONSE_EVENT = "prompt-template:subagent:response";
export const DELEGATION_CANCEL_EVENT = "prompt-template:subagent:cancel";

export type DelegationStatus =
	| "completed" | "failed" | "timed_out" | "cancelled" | "interrupted" | "tool_budget_exhausted"
	| "structured_output_failed" | "acceptance_failed" | "invalid_request" | "unavailable_context" | "duplicate_node";

export interface DelegationRequest {
	readonly requestId: string;
	readonly ownerRunId: string;
	readonly nodeId: string;
	readonly agent: string;
	readonly task: string;
	readonly cwd: string;
}
export interface DelegationCancel {
	readonly requestId: string;
	readonly ownerRunId: string;
	readonly nodeId: string;
}
export interface DelegationResponse {
	readonly requestId: string;
	readonly ownerRunId?: string;
	readonly nodeId?: string;
	readonly status: DelegationStatus;
	readonly error?: string;
	readonly runId?: string;
}

export type DelegationListener = {
	started(tuple: DelegationCancel): void;
	update(tuple: DelegationCancel, runId: string | undefined): void;
	response(response: DelegationResponse): void;
};

function asTuple(payload: unknown): DelegationCancel | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const record = payload as Record<string, unknown>;
	if (typeof record.requestId !== "string" || typeof record.ownerRunId !== "string" || typeof record.nodeId !== "string") return undefined;
	return { requestId: record.requestId, ownerRunId: record.ownerRunId, nodeId: record.nodeId };
}

/** Thin typed wrapper over the SA structured-delegation event family. */
export class DelegationBus {
	private readonly offs: Array<() => void> = [];
	private listener: DelegationListener | undefined;
	private readonly events: EventSurface;

	constructor(events: EventSurface) {
		this.events = events;
	}

	subscribe(listener: DelegationListener): void {
		if (this.listener) throw new Error("delegation listener already installed");
		this.listener = listener;
		this.offs.push(this.events.on(DELEGATION_STARTED_EVENT, (payload) => {
			const tuple = asTuple(payload);
			if (tuple) this.listener?.started(tuple);
		}));
		this.offs.push(this.events.on(DELEGATION_UPDATE_EVENT, (payload) => {
			const tuple = asTuple(payload);
			const runId = (payload as { runId?: unknown } | null)?.runId;
			if (tuple) this.listener?.update(tuple, typeof runId === "string" ? runId : undefined);
		}));
		this.offs.push(this.events.on(DELEGATION_RESPONSE_EVENT, (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as Record<string, unknown>;
			if (typeof record.requestId !== "string" || typeof record.status !== "string") return;
			this.listener?.response({
				requestId: record.requestId,
				status: record.status as DelegationStatus,
				...(typeof record.ownerRunId === "string" ? { ownerRunId: record.ownerRunId } : {}),
				...(typeof record.nodeId === "string" ? { nodeId: record.nodeId } : {}),
				...(typeof record.error === "string" ? { error: record.error } : {}),
				...(typeof record.runId === "string" ? { runId: record.runId } : {}),
			});
		}));
	}

	request(payload: DelegationRequest): void { this.events.emit(DELEGATION_REQUEST_EVENT, payload); }

	cancel(tuple: DelegationCancel): void { this.events.emit(DELEGATION_CANCEL_EVENT, tuple); }

	close(): void {
		for (const off of this.offs.splice(0)) off();
		this.listener = undefined;
	}
}
