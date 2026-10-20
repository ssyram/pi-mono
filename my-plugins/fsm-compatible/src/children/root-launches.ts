import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeError } from "../runtime/runtime-error.ts";
import type { DelegationBus } from "./delegation-bus.ts";
import { SerialQueue } from "./launch-queue.ts";
import type { ChildRuns } from "./child-runs.ts";

export interface BootstrapPayload {
	readonly bootstrapRef: string;
	readonly rootSessionId: string;
	readonly callerSessionId: string;
	readonly agentName: string;
	readonly bridgeUrl: string;
	readonly bridgePassword: string;
	readonly requiredExtensions: readonly { id: string; path: string }[];
	readonly allowedAgents: readonly string[];
	readonly maxDepth: number;
}

export interface LaunchPolicy {
	readonly allowedAgents: readonly string[];
	readonly maxDepth: number;
	readonly requiredExtensions: readonly { id: string; path: string }[];
}
export interface LaunchRequest {
	readonly agent: string;
	readonly task: string;
	readonly callerSessionId: string;
	readonly policy: LaunchPolicy;
	readonly deadline?: number;
	readonly signal?: AbortSignal;
}

export type LaunchOutcomeCode = "not-ready" | "queue-full" | "deadline-exceeded" | "delivery-unknown" | "cancelled" | "duplicate";
export type LaunchOutcome =
	| { readonly ok: true; readonly nodeId: string; readonly childSessionId: string | null }
	| { readonly ok: false; readonly code: LaunchOutcomeCode };

/**
 * B6 root launches: the FIFO serializes the handshake (bootstrap file, delegation
 * emit, child launch-ack or failure) before the next launch proceeds.
 */
export class RootLaunches {
	private readonly queue = new SerialQueue();
	private readonly acks = new Map<string, (childSessionId: string) => void>();
	private pending = 0;
	private readonly bus: DelegationBus;
	private readonly runs: ChildRuns;
	private readonly scope: string;
	private readonly capacity: number;
	private readonly rootSessionId: string;
	private readonly bridge: { url: string; password: string };
	private readonly childStartTimeoutMs: number;

	constructor(bus: DelegationBus, runs: ChildRuns, scope: string, capacity: number,
		rootSessionId: string, bridge: { url: string; password: string }, childStartTimeoutMs = 30000) {
		this.bus = bus;
		this.runs = runs;
		this.scope = scope;
		this.capacity = capacity;
		this.rootSessionId = rootSessionId;
		this.bridge = bridge;
		this.childStartTimeoutMs = childStartTimeoutMs;
		if (!scope || !Number.isSafeInteger(capacity) || capacity < 1 || !rootSessionId
			|| !bridge?.url || !bridge?.password) throw new RuntimeError("protocol-invalid");
	}

	static async openScope(base = tmpdir()): Promise<string> {
		return mkdtemp(join(base, "fsm-launch-"));
	}

	async disposeScope(): Promise<void> { await rm(this.scope, { recursive: true, force: true }); }

	launch(request: LaunchRequest): Promise<LaunchOutcome> {
		if (this.pending >= this.capacity || this.runs.activeSize >= this.capacity) {
			return Promise.resolve({ ok: false, code: "queue-full" });
		}
		if (request.deadline !== undefined && Date.now() >= request.deadline) {
			return Promise.resolve({ ok: false, code: "deadline-exceeded" });
		}
		if (request.signal?.aborted) return Promise.resolve({ ok: false, code: "cancelled" });
		this.pending += 1;
		return this.queue.enqueue(async () => {
			// fsm-4 residual: a queued launch that lost its caller while waiting stops here, before side effects.
			if (request.signal?.aborted) return { ok: false, code: "cancelled" };
			if (request.deadline !== undefined && Date.now() >= request.deadline) return { ok: false, code: "deadline-exceeded" };
			const bootstrapRef = randomUUID();
			const nodeId = `launch-${bootstrapRef}`;
			const payload: BootstrapPayload = {
				bootstrapRef, rootSessionId: this.rootSessionId, callerSessionId: request.callerSessionId,
				agentName: request.agent, bridgeUrl: this.bridge.url, bridgePassword: this.bridge.password,
				requiredExtensions: request.policy.requiredExtensions, allowedAgents: request.policy.allowedAgents,
				maxDepth: request.policy.maxDepth,
			};
			const file = join(this.scope, `${bootstrapRef}.json`);
			await writeFile(file, JSON.stringify(payload), { mode: 0o600 });
			this.runs.open({ requestId: bootstrapRef, ownerRunId: this.rootSessionId, nodeId }, request.callerSessionId, request.agent);
			const ack = new Promise<string>((resolve) => { this.acks.set(nodeId, resolve); });
			try {
				this.bus.request({ requestId: bootstrapRef, ownerRunId: this.rootSessionId, nodeId, agent: request.agent,
					task: `[fsm-bootstrap:${bootstrapRef}]\n\n${request.task}`, cwd: process.cwd() });
				const budget = Math.min(Date.now() + this.childStartTimeoutMs,
					request.deadline ?? Number.MAX_SAFE_INTEGER);
				const race = await Promise.race([
					ack.then((childSessionId) => ({ kind: "ack" as const, childSessionId })),
					this.runs.awaitTerminal(nodeId, budget, request.signal)
						.then((terminal) => ({ kind: "terminal" as const, terminal })),
				]);
				if (race.kind === "ack") {
					this.runs.onChildRegistered(nodeId, race.childSessionId);
					return { ok: true, nodeId, childSessionId: race.childSessionId };
				}
				if (race.terminal) {
					return race.terminal.status === "duplicate_node"
						? { ok: false, code: "duplicate" }
						: { ok: false, code: "not-ready" };
				}
				return { ok: false, code: "delivery-unknown" };
			} catch (error) {
				if (error instanceof RuntimeError && (error.code === "delivery-unknown" || error.code === "cancelled")) {
					this.runs.forget(nodeId);
				}
				if (error instanceof RuntimeError) {
					const code = error.code;
					return { ok: false, code: code === "queue-full" || code === "deadline-exceeded" || code === "delivery-unknown" || code === "cancelled" ? code : "not-ready" };
				}
				return { ok: false, code: "not-ready" };
			} finally {
				this.acks.delete(nodeId);
				this.pending -= 1;
			}
		});
	}

	onLaunchAck(bootstrapRef: string, childSessionId: string): void {
		const resolve = this.acks.get(`launch-${bootstrapRef}`);
		if (!resolve) throw new RuntimeError("not-ready");
		resolve(childSessionId);
	}

	static bootstrapPrefixPattern(): RegExp { return /^\[fsm-bootstrap:([0-9a-f-]{36})\]\n\n/; }

	static splitBootstrapTask(text: string): { bootstrapRef: string; task: string } | null {
		const match = RootLaunches.bootstrapPrefixPattern().exec(text);
		if (!match) return null;
		return { bootstrapRef: match[1]!, task: text.slice(match[0].length) };
	}

	static async readBootstrap(scope: string, bootstrapRef: string): Promise<BootstrapPayload> {
		if (!/^[0-9a-f-]{36}$/.test(bootstrapRef)) throw new RuntimeError("protocol-invalid");
		let raw: string;
		try {
			raw = await readFile(join(scope, `${bootstrapRef}.json`), "utf8");
		} catch {
			throw new RuntimeError("not-ready");
		}
		let value: BootstrapPayload;
		try {
			value = JSON.parse(raw) as BootstrapPayload;
		} catch {
			throw new RuntimeError("protocol-invalid");
		}
		if (value.bootstrapRef !== bootstrapRef) throw new RuntimeError("protocol-invalid");
		return value;
	}
}
