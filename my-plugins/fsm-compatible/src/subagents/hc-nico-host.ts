import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createDefaultChildSessionFactory, type ChildSession, type ChildSessionFactory, type ChildHookExtension, type ChildSessionEvent, type ParentProviderRegistry } from "./hc-nico-factory.ts";
import type { HcSessionRecord } from "./hc-session-record.ts";
import type { HcAgentDefinition } from "./hc-agent-definitions.ts";

const THINKING_LEVELS: readonly string[] = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface HcNicoLaunchPlan {
	readonly definition: HcAgentDefinition;
	readonly modelRef: string;
	readonly depth: number;
	readonly maxDepth: number;
	readonly hooks: readonly ChildHookExtension[];
}

export interface HcNicoHostOptions {
	readonly instanceDirectory: string;
	readonly parentSessionFile: string | undefined;
	readonly parentProviderRegistry: ParentProviderRegistry | undefined;
	readonly createFactory?: () => ChildSessionFactory;
}

/** Owning-runtime host around one Nico ChildSessionFactory; no default extension registration. */
export class HcNicoSessionHost {
	private readonly factory: ChildSessionFactory;
	private readonly options: HcNicoHostOptions;
	private closed = false;

	constructor(options: HcNicoHostOptions) {
		this.options = options;
		this.factory = options.createFactory ? options.createFactory() : createDefaultChildSessionFactory();
	}

	private buildLaunch(record: HcSessionRecord, plan: HcNicoLaunchPlan, signal?: AbortSignal) {
		const fanoutChild = record.depth < plan.maxDepth;
		return {
			cwd: this.options.instanceDirectory,
			storage: { kind: "file" as const, sessionFile: record.sessionFile },
			...(this.options.parentSessionFile ? { parentSessionFile: this.options.parentSessionFile } : {}),
			...(this.options.parentProviderRegistry ? { parentProviderRegistry: this.options.parentProviderRegistry } : {}),
			model: plan.modelRef,
			...(plan.definition.tools ? { tools: [...plan.definition.tools] } : {}),
			excludeTools: [...plan.definition.excludeTools],
			extensionPaths: [],
			ambientExtensions: false,
			hooks: [...plan.hooks],
			noSkills: false,
			noContextFiles: false,
			runtime: { fanoutChild, depth: record.depth, waitTool: { enabled: false }, fast: false },
			...(signal ? { signal } : {}),
		};
	}

	/** Create (or reopen by file) the real ChildSession and wire event observation. */
	async open(record: HcSessionRecord, plan: HcNicoLaunchPlan, onEvent: (record: HcSessionRecord, event: ChildSessionEvent) => void, signal?: AbortSignal): Promise<ChildSession> {
		if (this.closed) throw new Error("hc nico host closed");
		if (record.handle) return record.handle;
		await mkdir(dirname(record.sessionFile), { recursive: true });
		const debugErrors = process.env.FSM_DUAL_DEBUG ? { onExtensionError: (e: { extensionPath: string; event: string; error: unknown }) => { console.error("[hc-child-ext-error]", e.extensionPath, e.event, e.error); } } : {};
		const child = await this.factory.create({ ...this.buildLaunch(record, plan, signal), ...debugErrors });
		record.handle = child;
		record.hostSessionId = child.sessionId;
		child.subscribe((event) => {
			try {
				onEvent(record, event);
			} catch {
				/* listener isolation; the session keeps its own truth */
			}
		});
		return child;
	}

	/**
	 * HC deliver semantics: busy run consumes steer at its next step; an idle or
	 * aborted session starts its next run with prompt. Failures of the started
	 * run are returned for observation, never silently dropped.
	 */
	private readonly pendingStarts = new Map<string, { texts: string[]; timer: ReturnType<typeof setTimeout> | undefined }>();

	async deliver(record: HcSessionRecord, text: string): Promise<void> {
		const child = record.handle;
		if (!child) throw new Error(`hc session ${record.session_id} has no host handle`);
		if (record.status === "busy" || record.status === "retry") {
			await child.steer(text);
			return;
		}
		// HC parity: delivery enqueues synchronously but starts the run
		// asynchronously (Effect fork + session pipeline), and back-to-back
		// sends join the first run as separate user messages. Trailing merge:
		// every idle send resets the start timer, the batch flushes as prompt
		// (first) + queued steers (rest), preserving one user message per send.
		record.status = "busy";
		const pending = this.pendingStarts.get(record.session_id) ?? { texts: [] as string[], timer: undefined as ReturnType<typeof setTimeout> | undefined };
		pending.texts.push(text);
		if (pending.timer) clearTimeout(pending.timer);
		pending.timer = setTimeout(() => {
			this.pendingStarts.delete(record.session_id);
			const [first, ...rest] = pending.texts;
			if (!first) return;
			for (const later of rest) void child.steer(later);
			// A new run's completion is an async notification, never awaited
			// here; failures surface through the session event stream.
			void child.prompt(first).then(() => {
				record.status = "idle";
			}, (error) => {
				record.status = "idle";
				try {
					record.lastOutcome = { kind: "failed", text: error instanceof Error ? error.message : String(error), summary: "" };
				} catch {
					/* record frozen paths stay on the event stream */
				}
			});
		}, 2000);
		this.pendingStarts.set(record.session_id, pending);
	}

	hasQueuedInput(record: HcSessionRecord): boolean {
		try {
			return record.handle?.hasQueuedMessages?.() === true;
		} catch {
			return false;
		}
	}

	async cancel(record: HcSessionRecord): Promise<void> {
		const child = record.handle;
		if (!child) return;
		await child.abort();
	}

	/** Owning-runtime shutdown only: releases the real factory and its children. */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.factory.dispose();
	}
}

export function hcModelRef(providerID: string, modelID: string, variant: string): string {
	const base = `${providerID}/${modelID}`;
	return variant !== "default" && THINKING_LEVELS.includes(variant) ? `${base}:${variant}` : base;
}
