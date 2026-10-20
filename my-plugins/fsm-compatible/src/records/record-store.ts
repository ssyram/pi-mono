import type { PersistedBinding } from "../binding/actor-binding.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { normalizeIsoTimestamp, requireEventMillis } from "./record-time.ts";
import type { ExecutionRecord, JudgeRecord, RecordFacts } from "./session-record.ts";

function toExecutionRecord(binding: PersistedBinding, facts: RecordFacts): ExecutionRecord {
	return Object.freeze({
		sessionId: binding.sessionId,
		parentSessionId: binding.kind === "execution-child" ? binding.parentSessionId : null,
		agentId: binding.agentId,
		agentName: binding.kind === "execution-child" ? binding.agentName : null,
		title: facts.title,
		lifecycle: facts.lifecycle,
		updatedAt: facts.updatedAt,
		header: facts.header,
		branch: Object.freeze([...facts.branch]),
		sessionFile: facts.sessionFile,
		errorMessage: facts.errorMessage,
	});
}

/** Session-owned execution/judge record index. No cross-session globals. */
export class RecordStore {
	private readonly executions = new Map<string, ExecutionRecord>();
	private readonly judges = new Map<string, JudgeRecord>();
	private readonly rootSessionId: string;
	private closed = false;

	constructor(rootBinding: PersistedBinding) {
		// Root-owned store, or a dispatched child's local store: the child runs in
		// its own process and records only its own execution under the root session.
		if (rootBinding.kind === "execution-root") {
			if (rootBinding.agentId !== "main" || rootBinding.sessionId !== rootBinding.rootSessionId) {
				throw new RuntimeError("protocol-invalid");
			}
		} else if (rootBinding.kind === "execution-child") {
			if (rootBinding.agentId !== rootBinding.sessionId || rootBinding.sessionId === rootBinding.rootSessionId || rootBinding.agentId === "main") {
				throw new RuntimeError("protocol-invalid");
			}
		} else {
			throw new RuntimeError("protocol-invalid");
		}
		this.rootSessionId = rootBinding.rootSessionId;
	}

	// Step P1: actual binding/header/raw branch -> complete terminal snapshot -> lifecycle.
	publishExecution(binding: PersistedBinding, facts: RecordFacts): void {
		if (this.closed) throw new RuntimeError("owner-unavailable");
		if (binding.rootSessionId !== this.rootSessionId) throw new RuntimeError("protocol-invalid");
		if (binding.sessionId === "main") throw new RuntimeError("protocol-invalid");
		requireEventMillis(facts.updatedAt);
		if (facts.header) {
			if (facts.header.id !== binding.sessionId) throw new RuntimeError("protocol-invalid");
			normalizeIsoTimestamp(facts.header.timestamp);
		}
		if (!Array.isArray(facts.branch)) throw new RuntimeError("protocol-invalid");
		if (binding.sessionId === this.rootSessionId && (binding.kind !== "execution-root" || binding.agentId !== "main")) {
			throw new RuntimeError("protocol-invalid");
		}
		this.executions.set(binding.sessionId, toExecutionRecord(binding, facts));
	}

	registerJudge(record: JudgeRecord): void {
		if (this.closed) throw new RuntimeError("owner-unavailable");
		if (!record.sessionId || !record.title) throw new RuntimeError("protocol-invalid");
		requireEventMillis(record.createdAt);
		requireEventMillis(record.updatedAt);
		this.judges.set(record.sessionId, record);
	}

	updateJudge(sessionId: string, lifecycle: JudgeRecord["lifecycle"], updatedAt: number): void {
		const record = this.judges.get(sessionId);
		if (!record || this.closed) throw new RuntimeError("not-ready");
		record.lifecycle = lifecycle;
		record.updatedAt = requireEventMillis(updatedAt);
	}

	getExecution(sessionId: string): ExecutionRecord | undefined { return this.executions.get(sessionId); }

	getJudge(sessionId: string): JudgeRecord | undefined { return this.judges.get(sessionId); }

	executionChildren(parentSessionId: string): readonly ExecutionRecord[] {
		return [...this.executions.values()].filter((record) => record.parentSessionId === parentSessionId);
	}

	listExecutions(): readonly ExecutionRecord[] { return [...this.executions.values()]; }

	listJudges(): readonly JudgeRecord[] { return [...this.judges.values()]; }

	get rootId(): string { return this.rootSessionId; }

	get closedStore(): boolean { return this.closed; }

	close(): void { this.closed = true; }
}
