import { RuntimeError } from "../runtime/runtime-error.ts";
import type { DelegationBus, DelegationCancel, DelegationResponse } from "./delegation-bus.ts";

export type ChildLifecycle = "idle" | "failed" | "aborted" | "unavailable" | "busy";

export function lifecycleForStatus(status: string): ChildLifecycle {
	switch (status) {
		case "completed": return "idle";
		case "failed": case "timed_out": case "tool_budget_exhausted": case "structured_output_failed":
		case "acceptance_failed": case "unavailable_context": case "invalid_request":
			return "failed";
		case "cancelled": case "interrupted": return "aborted";
		default: return "unavailable";
	}
}

export interface ChildRunInfo {
	readonly tuple: DelegationCancel;
	readonly callerSessionId: string;
	readonly agentName: string;
	childSessionId: string | null;
	runId: string | null;
	terminal: DelegationResponse | null;
	unknown: boolean;
}

interface Waiting {
	readonly nodeId: string;
	resolve(terminal: DelegationResponse | null): void;
}

/** B7: run-key correlation and real-caller notification. No second terminal is accepted. */
export class ChildRuns {
	private readonly rows = new Map<string, ChildRunInfo>();
	private readonly finished = new Map<string, ChildRunInfo>();
	private readonly waiters = new Set<Waiting>();
	private readonly capacity: number;
	private readonly finishedCapacity: number;
	private readonly notify: (callerSessionId: string, run: ChildRunInfo) => void;

	constructor(capacity: number, notify: (callerSessionId: string, run: ChildRunInfo) => void, finishedCapacity = 64) {
		if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(finishedCapacity) || finishedCapacity < 1) {
			throw new RuntimeError("protocol-invalid");
		}
		this.capacity = capacity;
		this.finishedCapacity = finishedCapacity;
		this.notify = notify;
	}

	get activeSize(): number { return this.rows.size; }

	open(tuple: DelegationCancel, callerSessionId: string, agentName: string): ChildRunInfo {
		if (this.rows.has(tuple.nodeId)) throw new RuntimeError("queue-full");
		if (this.rows.size >= this.capacity) throw new RuntimeError("queue-full");
		const info: ChildRunInfo = { tuple, callerSessionId, agentName, childSessionId: null, runId: null, terminal: null, unknown: false };
		this.rows.set(tuple.nodeId, info);
		return info;
	}

	find(nodeId: string): ChildRunInfo | undefined { return this.rows.get(nodeId) ?? this.finished.get(nodeId); }

	onStarted(tuple: DelegationCancel): void { void tuple; }

	onUpdate(tuple: DelegationCancel, runId: string | undefined): void {
		const row = this.rows.get(tuple.nodeId);
		if (!row || row.tuple.requestId !== tuple.requestId) return;
		if (runId) row.runId = runId;
	}

	onChildRegistered(nodeId: string, childSessionId: string): void {
		const row = this.rows.get(nodeId);
		if (!row) throw new RuntimeError("not-ready");
		row.childSessionId = childSessionId;
	}

	// Step P2: one terminal per attempt; only that row's waiters are resolved.
	onTerminal(response: DelegationResponse): void {
		if (!response.nodeId) return;
		const row = this.rows.get(response.nodeId);
		if (!row) {
			const done = this.finished.get(response.nodeId);
			if (done && done.tuple.requestId === response.requestId) throw new RuntimeError("protocol-invalid");
			return;
		}
		if (row.tuple.requestId !== response.requestId) return;
		if (row.terminal) throw new RuntimeError("protocol-invalid");
		row.terminal = response;
		this.rows.delete(response.nodeId);
		this.finished.set(response.nodeId, row);
		while (this.finished.size > this.finishedCapacity) {
			const oldest = this.finished.keys().next().value;
			if (oldest === undefined) break;
			this.finished.delete(oldest);
		}
		this.notify(row.callerSessionId, row);
		for (const waiter of [...this.waiters]) {
			if (waiter.nodeId === response.nodeId) {
				this.waiters.delete(waiter);
				waiter.resolve(response);
			}
		}
	}

	markUnknown(nodeId: string): void {
		const row = this.rows.get(nodeId);
		if (row) row.unknown = true;
	}

	/** A handshake abandoned without a terminal frees its capacity; the row stays queryable as unknown. */
	forget(nodeId: string): void {
		const row = this.rows.get(nodeId);
		if (!row || row.terminal) return;
		row.unknown = true;
		this.rows.delete(nodeId);
		this.finished.set(nodeId, row);
	}

	awaitTerminal(nodeId: string, deadline: number, signal?: AbortSignal): Promise<DelegationResponse | null> {
		const row = this.find(nodeId);
		if (!row) return Promise.reject(new RuntimeError("not-ready"));
		if (row.terminal) return Promise.resolve(row.terminal);
		if (row.unknown) return Promise.reject(new RuntimeError("delivery-unknown"));
		return new Promise((resolve, reject) => {
			const waiting: Waiting = { nodeId, resolve: (terminal) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				resolve(terminal);
			} };
			const finish = (error?: RuntimeError) => {
				this.waiters.delete(waiting);
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(null);
			};
			const timer = setTimeout(() => {
				const active = this.rows.get(nodeId);
				if (active) active.unknown = true;
				finish(new RuntimeError("delivery-unknown"));
			}, Math.max(0, deadline - Date.now()));
			timer.unref();
			const abort = () => finish(new RuntimeError("cancelled"));
			signal?.addEventListener("abort", abort, { once: true });
			this.waiters.add(waiting);
		});
	}

	cancel(bus: DelegationBus, nodeId: string, deadline: number, signal?: AbortSignal): Promise<DelegationResponse> {
		const row = this.find(nodeId);
		if (!row) return Promise.reject(new RuntimeError("not-ready"));
		if (row.terminal) return Promise.resolve(row.terminal);
		bus.cancel(row.tuple);
		return this.awaitTerminal(nodeId, deadline, signal).then((terminal) => {
			if (!terminal) { row.unknown = true; throw new RuntimeError("delivery-unknown"); }
			return terminal;
		});
	}
}
