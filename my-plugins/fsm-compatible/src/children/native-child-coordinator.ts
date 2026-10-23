import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { admitChildLaunch } from "../admission/admit-child-launch.ts";
import { savedNativeChildren } from "./native-child-snapshot.ts";
import { writeChildExtensionBundle } from "./native-child-bootstrap.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import type { AdmissionPolicy, RequiredExtensionInput } from "../admission/admission-policy.ts";
import type { PersistedBinding } from "../binding/actor-binding.ts";
import type { RecordStore } from "../records/record-store.ts";
import type { FsmCompatibleConfig } from "../runtime/runtime-config.ts";
import type { NativeChildRecord } from "./native-child-record.ts";
import { NativeChildRegistry } from "./native-child-registry.ts";
import { NativeChildSession } from "./native-child-session.ts";
import { prepareNativeChild } from "./prepare-native-child.ts";
import { SerialQueue } from "./launch-queue.ts";
import { parentDepth } from "../binding/parent-chain.ts";
import { tmuxHasSession, tmuxKillSession } from "./tmux-session.ts";
import { patchChildMetadata, readChildMetadata } from "./child-metadata.ts";
import { OcHttpError } from "../protocol/oc-route.ts";
import type { NativeFsmPool } from "./native-fsm-pool.ts";

export interface NativeCoordinatorOptions {
	readonly config: FsmCompatibleConfig;
	readonly policy: AdmissionPolicy;
	readonly binding: PersistedBinding;
	readonly store: RecordStore;
	readonly stateDirectory: string;
	readonly fsm: NativeFsmPool;
	readonly cli: string;
	readonly extensions: readonly RequiredExtensionInput[];
	url(): string;
	readonly bridgePassword: string;
	rootIdle(): boolean;
	readonly entries: readonly SessionEntry[];
	persist(row: NativeChildRecord): void;
	notify(text: string): void;
	authorize(caller: PersistedBinding, action: string, input: unknown, signal?: AbortSignal): Promise<void>;
}

export class NativeChildCoordinator {
	readonly registry: NativeChildRegistry;
	readonly childEvents = new Set<(sessionId: string, event: Record<string, unknown>) => void>();
	private readonly sessions = new Map<string, NativeChildSession>();
	private readonly queue = new SerialQueue();
	private readonly stopping = new Set<string>();
	private readonly options: NativeCoordinatorOptions;
	private closed = false;
	private readonly abort = new AbortController();

	constructor(options: NativeCoordinatorOptions) {
		this.options = options; this.registry = new NativeChildRegistry(options.binding);
		for (const row of savedNativeChildren(options.entries, options.binding.rootSessionId, options.stateDirectory)) {
			this.registry.rows.set(row.binding.sessionId, { ...row, token: randomBytes(32).toString("hex") });
		}
		for (const row of this.registry.rows.values()) {
			const depth = parentDepth(options.binding.rootSessionId, row.binding.sessionId, this.registry);
			if (!depth.ok || depth.value !== row.depth) throw new Error("invalid saved native ancestry");
		}
	}

	/** Root-privileged entry (no private-route token): re-authorize with the real FSM, then run. */
	async manual(action: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
		if (this.closed) throw new Error("native coordinator closed");
		await this.options.authorize(this.options.binding, action, input, signal);
		return this.call(this.options.binding, action, input, signal);
	}

	async handle(body: unknown, signal?: AbortSignal, onProgress?: (value: unknown) => void): Promise<{ value: unknown }> {
		if (this.closed) throw new OcHttpError(503);
		if (!isAdmissionObject(body) || typeof body.action !== "string"
			|| Object.keys(body).some((key) => !["token", "action", "input"].includes(key))) throw new OcHttpError(400);
		let caller: PersistedBinding;
		try { caller = this.registry.caller(body.token); } catch { throw new OcHttpError(403); }
		if (body.action === "ready") {
			if (!isAdmissionObject(body.input) || body.input.sessionId !== caller.sessionId) throw new Error("child ready identity mismatch");
			this.registry.rows.get(caller.sessionId)?.ready?.resolve();
			return { value: true };
		}
		if (body.action === "catalog") return { value: { tools: [...this.options.fsm.catalog.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
		if (body.action === "event") {
			if (!isAdmissionObject(body.input) || typeof body.input.type !== "string") throw new OcHttpError(400);
			const row = this.registry.rows.get(caller.sessionId);
			if (row) this.childEvent(row, body.input as { type: string });
			return { value: true };
		}
		if (body.action === "fsm-tool") {
			if (!isAdmissionObject(body.input) || typeof body.input.name !== "string" || typeof body.input.deadline !== "number"
				|| !Number.isFinite(body.input.deadline) || Object.keys(body.input).some((key) => !["name", "arguments", "deadline"].includes(key))) throw new OcHttpError(400);
			const deadline = Math.min(body.input.deadline, Date.now() + this.options.config.timeoutMs * 10);
			return { value: await this.options.fsm.invoke(caller, body.input.name, body.input.arguments,
				{ deadline, ...(signal ? { signal } : {}), ...(onProgress ? { onProgress } : {}) }) };
		}
		if (body.action !== "busy") await this.options.authorize(caller, body.action, body.input, signal);
		const input = body.action === "launch" && isAdmissionObject(body.input)
			? { ...body.input, model: this.registry.rows.get(caller.sessionId)!.model,
				thinking: this.registry.rows.get(caller.sessionId)!.thinking } : body.input;
		return { value: await this.call(caller, body.action, input, signal) };
	}

	async call(caller: PersistedBinding, action: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
		const operationSignal = AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]);
		operationSignal.throwIfAborted();
		if (this.closed) throw new Error("native coordinator closed");
		if (!isAdmissionObject(input) || !isAdmissionObject(input.params)
			|| Object.keys(input).some((key) => !["params", "model", "thinking"].includes(key))) throw new Error("invalid native input");
		const params = input.params;
		if (action === "busy") return this.busy(caller.sessionId);
		if (action === "launch") {
			if (typeof input.model !== "string" || !input.model) throw new Error("native Agent requires a host model");
			const model = input.model, thinking = input.thinking;
			if (typeof thinking !== "string") throw new Error("native thinking level required");
			return this.queue.enqueue(() => this.launch(caller, params, model, thinking, operationSignal));
		}
		if (action === "list") {
			await this.reconcileDead();
			return this.registry.visible(caller.sessionId).map((binding) => {
				const row = this.registry.rows.get(binding.sessionId);
				return { session_id: binding.sessionId, parent_session_id: binding.parentSessionId, name: row?.name ?? null,
					status: row ? row.runActive ? "running" : "idle" : this.options.rootIdle() ? "idle" : "running",
					last_outcome: row?.outcome ?? null, tmux: row?.tmuxSession ?? null,
					available: row ? row.lifecycle !== "unavailable" : true };
			});
		}
		if (action === "status") {
			if (typeof params.target !== "string") throw new Error("native target required");
			const row = this.registry.target(caller.sessionId, params.target);
			const meta = await readChildMetadata(row.directory).catch(() => null);
			const recent = await readTranscriptTail(row.sessionFile, 8);
			return { session_id: row.binding.sessionId, name: row.name, state: meta?.state ?? row.lifecycle,
				outcome: row.outcome, run_active: row.runActive, tmux: row.tmuxSession,
				model: row.model, thinking: row.thinking, cwd: row.cwd,
				elapsed_ms: meta ? Date.now() - Date.parse(meta.createdAt) : null,
				recent_activity: recent };
		}
		if (typeof params.target !== "string") throw new Error("native target required");
		if (action === "send") {
			if (typeof params.message !== "string" || !params.message) throw new Error("native message required");
			const message = `[Message from ${caller.sessionId}]\n${params.message}`;
			if (params.target === this.options.binding.sessionId) this.options.notify(message);
			else {
				const row = this.registry.target(caller.sessionId, params.target);
				await this.queue.enqueue(async () => { await this.start(row, operationSignal); operationSignal.throwIfAborted(); await this.sessions.get(row.binding.sessionId)!.prompt(message); });
			}
			return { accepted: true, session_id: params.target };
		}
		if (action === "stop") {
			const row = this.registry.target(caller.sessionId, params.target, true);
			const targets = [...this.registry.descendants(row.binding.sessionId).reverse(), row];
			for (const target of targets) this.stopping.add(target.binding.sessionId);
			let failed = 0;
			try { for (const target of targets) {
				if (target.startController) { target.startController.abort(); await tmuxKillSession(target.tmuxSession); }
				else await this.sessions.get(target.binding.sessionId)?.stop();
			} }
			finally { for (const target of targets) this.stopping.delete(target.binding.sessionId); }
			return { stopped: targets.length - failed, failed };
		}
		throw new Error("unknown native action");
	}

	busy(parent: string): boolean {
		return this.registry.descendants(parent).some((row) => row.runActive || row.lifecycle === "starting");
	}
	refresh(): void {
		for (const row of this.registry.rows.values()) {
			const session = this.sessions.get(row.binding.sessionId) ?? new NativeChildSession(row, this.sessionOptions());
			session.publish(this.options.store);
		}
	}
	async close(): Promise<void> {
		this.closed = true; this.abort.abort();
		await this.queue.enqueue(async () => {});
		await Promise.allSettled([...this.sessions.values()].map(async (session) => { await session.suspend().catch(() => undefined); }));
		await Promise.allSettled([...this.registry.rows.values()].map(async (row) => {
			if (!this.sessions.has(row.binding.sessionId)) { await tmuxKillSession(row.tmuxSession); await patchChildMetadata(row.directory, { state: "suspended" }).catch(() => undefined); }
		}));
	}

	private async launch(caller: PersistedBinding, input: Record<string, unknown>, model: string, thinking: string, signal: AbortSignal): Promise<unknown> {
		if (this.closed || [...this.registry.rows.values()].filter((row) => row.runActive || row.lifecycle === "starting").length >= this.options.config.capacity) {
			throw new Error("native Agent capacity unavailable");
		}
		const row = await prepareNativeChild({ caller, input, model, thinking, config: this.options.config,
			policy: this.options.policy, registry: this.registry, extensions: this.options.extensions, stateDirectory: this.options.stateDirectory });
		signal.throwIfAborted();
		this.registry.rows.set(row.binding.sessionId, row);
		try {
			await this.start(row, signal);
			signal.throwIfAborted();
			const status = await this.sessions.get(row.binding.sessionId)!.prompt(`Work in ${row.cwd}.\n\n${input.prompt}`);
			this.options.persist(row);
			return { session_id: row.binding.sessionId, parent_session_id: caller.sessionId, subagent_type: row.binding.agentName,
				name: row.name, cwd: row.cwd, model: row.model, thinking: row.thinking, status };
		} catch (error) {
			await tmuxKillSession(row.tmuxSession); this.registry.rows.delete(row.binding.sessionId); this.sessions.delete(row.binding.sessionId); throw error;
		}
	}

	private async start(row: NativeChildRecord, signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		if (await tmuxHasSession(row.tmuxSession)) return;
		const caller = this.registry.find(row.binding.parentSessionId)?.binding;
		if (!caller) throw new Error("restored child parent unavailable");
		const admitted = admitChildLaunch(this.options.policy, { rootSessionId: caller.rootSessionId, sessionId: caller.sessionId },
			{ agentName: row.binding.agentName, executionMode: "async", resumeSessionFile: row.sessionFile }, this.registry,
			{ availableToolNames: [], requiredToolNames: [] }, { saved: row.binding, actualSessionId: row.binding.sessionId });
		if (!admitted.ok) throw new Error(`child resume rejected: ${admitted.code}`);
		if (await readChildMetadata(row.directory).then((meta) => meta?.state === "suspended")) await patchChildMetadata(row.directory, { state: "starting" });
		row.startController = new AbortController();
		try {
			const startSignal = AbortSignal.any([row.startController.signal, ...(signal ? [signal] : [])]);
			await writeChildExtensionBundle(row.bundle, this.options.extensions); startSignal.throwIfAborted();
			const session = new NativeChildSession(row, this.sessionOptions());
			this.sessions.set(row.binding.sessionId, session);
			await session.start(this.options.config.timeoutMs * 2, startSignal);
			this.options.persist(row);
		} finally { row.startController = undefined; }
	}

	private sessionOptions() {
		return { cli: this.options.cli, coordinatorUrl: this.options.url, bridgePassword: this.options.bridgePassword,
			env: { ...process.env, ...this.options.config.env }, report: (record: NativeChildRecord) => this.report(record), closing: () => this.closed,
			onEvent: (row: NativeChildRecord, event: Record<string, unknown>) => {
				for (const listener of this.childEvents) { try { listener(row.binding.sessionId, event); } catch { /* listener isolation */ } }
			} };
	}

	addChildEventListener(listener: (sessionId: string, event: Record<string, unknown>) => void): () => void {
		this.childEvents.add(listener);
		return () => { this.childEvents.delete(listener); };
	}

	/** Child lifecycle telemetry over HTTP; file metadata remains the durable truth. */
	private childEvent(row: NativeChildRecord, event: { type: string }): void {
		if (event.type === "agent_start") {
			row.runActive = true; row.lifecycle = "running";
			row.outcome = null; row.summary = "";
		}
		if (event.type === "agent_settled" && row.runActive) {
			row.runActive = false;
			row.outcome = row.outcome ?? "completed";
			row.lifecycle = row.outcome === "failed" ? "failed" : "idle";
			if (!this.closed) void this.report(row);
		}
		if (event.type === "child_exited") {
			row.runActive = false;
			row.lifecycle = "unavailable";
			if (row.outcome === null) row.outcome = "exited";
		}
	}

	/** Lazy reconciliation: a dead tmux session that nobody reported means a crash. */
	private async reconcileDead(): Promise<void> {
		if (this.closed) return;
		for (const row of this.registry.rows.values()) {
			if (row.lifecycle === "unavailable" || row.lifecycle === "starting") continue;
			if (await tmuxHasSession(row.tmuxSession)) continue;
			row.runActive = false;
			row.lifecycle = "unavailable";
			if (row.outcome === null || row.outcome === "completed") row.outcome = "crashed";
			await patchChildMetadata(row.directory, { state: "exited", outcome: row.outcome }).catch(() => {});
		}
	}

	private async report(row: NativeChildRecord): Promise<void> {
		if (!row.summary) row.summary = await readLatestAssistant(row.sessionFile).catch(() => "");
		this.options.persist(row);
		const text = `[Agent ${row.binding.sessionId} ${row.outcome}]\n${row.summary}`;
		const parent = row.binding.parentSessionId;
		if (this.closed || this.stopping.has(parent)) return;
		if (parent === this.options.binding.sessionId) this.options.notify(text);
		else {
			const session = this.sessions.get(parent);
			if (session && await session.alive()) void session.prompt(text).catch(() => { row.outcome = "delivery-failed"; });
		}
	}
}

/** Read the last assistant message from the active branch of a session file (Mario readLatestAssistant semantics). */
async function readLatestAssistant(sessionFile: string): Promise<string> {
	const raw = await readFile(sessionFile, "utf8").catch(() => "");
	const entries: Array<{ type?: string; message?: { role?: string; content?: { type?: string; text?: string }[] | string } }> = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try { entries.push(JSON.parse(line)); } catch { break; }
	}
	for (let index = entries.length - 1; index >= 0; index--) {
		const message = entries[index]!.message;
		if (!message || message.role !== "assistant" || !message.content) continue;
		const text = typeof message.content === "string" ? message.content
			: message.content.filter((block) => typeof block?.text === "string").map((block) => block.text ?? "").join("\n");
		if (text.trim()) return text.slice(0, 4000);
	}
	return "";
}

/** Last N meaningful entries from a child session file — transcript-level visibility for the parent model. */
async function readTranscriptTail(sessionFile: string, maxEntries: number): Promise<string[]> {
	const raw = await readFile(sessionFile, "utf8").catch(() => "");
	const lines = raw.split("\n").filter((line) => line.trim());
	const tail: string[] = [];
	for (let i = lines.length - 1; i >= 0 && tail.length < maxEntries; i--) {
		try {
			const entry = JSON.parse(lines[i]!) as { type?: string; message?: { role?: string; timestamp?: string; content?: { type?: string; text?: string; name?: string }[] | string } };
			if (entry.type !== "message" || !entry.message) continue;
			const role = entry.message.role ?? "?";
			const ts = entry.message.timestamp ? new Date(entry.message.timestamp).toISOString().slice(11, 19) : "??:??:??";
			const content = entry.message.content;
			if (typeof content === "string") { tail.unshift(`${ts} ${role}: ${content.slice(0, 200)}`); continue; }
			for (const block of content ?? []) {
				if (typeof block.text === "string" && block.text.trim()) { tail.unshift(`${ts} ${role}: ${block.text.slice(0, 200)}`); break; }
				if (typeof block.name === "string") { tail.unshift(`${ts} ${role}: [tool:${block.name}]`); break; }
			}
		} catch { /* skip partial lines */ }
	}
	return tail;
}
