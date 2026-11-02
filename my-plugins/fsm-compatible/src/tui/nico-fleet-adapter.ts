// Drives pi-subagents' own fleet TUI (status widget + inspector overlay) from
// fsm-compatible child records. The vendor extension never runs here: children
// are published into its in-process external-run registry (the display-only
// channel for runs owned by another runtime), the vendor status widget renders
// those rows, and the inspector opens over the same state. FSM state rides in
// each row's `currentAction`.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExternalRun } from "../../.build/nico/api/external-runs.js";
import { registerExternalRun, unregisterExternalRun, updateExternalRun } from "../../.build/nico/api/external-runs.js";
import type { SubagentState } from "../../.build/nico/shared/types.js";
import type { FleetActionHandlers } from "../../.build/nico/tui/fleet.js";
import { openSubagentFleet } from "../../.build/nico/tui/fleet.js";
import { SubagentFleetStatus } from "../../.build/nico/tui/fleet-status.js";
import { open } from "node:fs/promises";
import { renderFleetTranscript, type FleetTranscript, type FleetTranscriptEvent } from "../../.build/nico/tui/fleet-transcript.js";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { FleetChildView, FleetView } from "../subagents/hc-fleet-view.ts";
import { SessionStatsReader, type ChildStats } from "./fleet-stats.ts";

export interface FleetActorFact {
	readonly agentId: string;
	readonly fsmName: string;
	readonly stateId: string;
	readonly noProgress: number;
}

export interface NicoFleetDeps {
	readonly fleet: () => FleetView;
	readonly actors: () => Promise<readonly FleetActorFact[]>;
	readonly rootSessionId: string;
	readonly rootSessionFile?: () => string | undefined;
	readonly baseCwd: string;
	/** Context-window size per model ref, for the row's ctx percentage. */
	readonly contextWindowOf: (modelRef: string) => number | null;
	/** Requests abort on the child's live handle; rejects when the child has none. */
	readonly abortChild: (sessionId: string) => Promise<void>;
}

export interface NicoFleetStatusOptions extends NicoFleetDeps {
	readonly placement: "aboveEditor" | "belowEditor";
}

const PUBLISH_MS = 1000;
const SOURCE = "fsm-compatible";

function displaySafe(text: string): string {
	return text.replace(/[\p{C}]/gu, "").trim().slice(0, 160);
}

function fsmAction(actor: FleetActorFact | undefined): string | undefined {
	if (!actor) return undefined;
	const text = `fsm:${actor.fsmName}:${actor.stateId}${actor.noProgress > 0 ? ` ⏱${actor.noProgress}` : ""}`;
	return displaySafe(text) || undefined;
}

function formatTokensShort(total: number): string {
	if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
	if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
	return String(Math.round(total));
}

const IDENTITY_THEME = new Proxy({}, { get: () => (...args: unknown[]) => String(args[args.length - 1] ?? "") }) as never;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

type MutableToolEvent = { kind: "tool"; toolCallId?: string; name: string; args?: string; status: "running" | "complete" | "error"; error?: string; output?: string };

/** Maps pi-native session records onto the vendor transcript event model. */
function toTranscriptEvents(records: readonly unknown[]): FleetTranscriptEvent[] {
	const events: Array<FleetTranscriptEvent | MutableToolEvent> = [];
	const findTool = (id: string): MutableToolEvent | undefined => {
		for (let index = events.length - 1; index >= 0; index--) {
			const event = events[index]!;
			if (event.kind === "tool" && event.toolCallId === id) return event as MutableToolEvent;
		}
		return undefined;
	};
	for (const raw of records) {
		const message = (raw as { message?: { role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean } }).message;
		if (!message?.role) continue;
		if (message.role === "user") {
			const text = typeof message.content === "string" ? message.content : "";
			if (text.trim() !== "") events.push({ kind: "user", text: text.slice(0, 200) });
		} else if (message.role === "assistant") {
			for (const block of Array.isArray(message.content) ? message.content : []) {
				const b = block as { type?: string; text?: string; name?: string; id?: string; arguments?: Record<string, unknown> };
				if (b.type === "text" && b.text?.trim()) events.push({ kind: "assistant", text: b.text.slice(0, 400) });
				else if (b.type === "toolCall" && b.name) {
					const firstArg = b.arguments ? Object.values(b.arguments)[0] : undefined;
				events.push({ kind: "tool", ...(b.id ? { toolCallId: b.id } : {}), name: b.name,
						...(firstArg !== undefined ? { args: JSON.stringify(firstArg).slice(0, 120) } : {}), status: "running" });
				}
			}
		} else if (message.role === "toolResult") {
			const failed = message.isError === true;
			const blocks = Array.isArray(message.content) ? message.content : [];
			const output = String((blocks[0] as { text?: string } | undefined)?.text ?? "");
			const tool = message.toolCallId ? findTool(message.toolCallId) : undefined;
			if (tool) {
				tool.status = failed ? "error" : "complete";
				const firstLine = output.split("\n")[0] ?? "";
				if (failed) tool.error = firstLine.slice(0, 200);
				else tool.output = output.split("\n").slice(0, 3).join("\n").slice(0, 300);
			} else {
				events.push({ kind: "tool", ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
					name: message.toolName ?? "tool", status: failed ? "error" : "complete",
					...(output !== "" ? { output: output.split("\n").slice(0, 3).join("\n").slice(0, 300) } : {}) });
			}
		}
	}
	return events as FleetTranscriptEvent[];
}

/** Live transcript tail for the inspector's Preview pane, in the vendor transcript layout. */
function renderPreviewRecords(records: readonly unknown[]): string | undefined {
	const events = toTranscriptEvents(records).slice(-14);
	if (events.length === 0) return undefined;
	const transcript: FleetTranscript = { path: "", events, truncated: false };
	const lines = renderFleetTranscript(transcript, 96, IDENTITY_THEME, getMarkdownTheme());
	const text = lines.join("\n").replace(ANSI, "").slice(-4_000).trim();
	return text === "" ? undefined : text;
}

async function livePreview(sessionFile: string): Promise<string | undefined> {
	try {
		const handle = await open(sessionFile, "r");
		try {
			const { size } = await handle.stat();
			const readBytes = Math.min(size, 24_576);
			const buffer = Buffer.alloc(readBytes);
			await handle.read(buffer, 0, readBytes, size - readBytes);
			const lines = buffer.toString("utf8").split("\n");
			if (size > readBytes) lines.shift();
			const records = lines.filter((line) => line.trim() !== "").map((line) => {
				try { return JSON.parse(line); } catch { return undefined; }
			}).filter((value): value is unknown => value !== undefined);
			return renderPreviewRecords(records);
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
}

/** Projects one child view plus its daemon actor facts onto a vendor external-run row. */
export function toExternalRun(view: FleetChildView, actor: FleetActorFact | undefined, stats: ChildStats, ownerSessionId: string, preview?: string): ExternalRun {
	const now = Date.now();
	const action = fsmAction(actor);
	const baseLabel = displaySafe(view.name ?? view.sessionId) || view.sessionId;
	// The vendor external roster renders `agent · state · elapsed` only, so the
	// label is the one surface we control: FSM state plus live usage in the
	// native status-bar format (`↓ N window · M spent`).
	const usage = stats.spentTokens > 0 || stats.windowTokens !== null
		? `↓ ${formatTokensShort(stats.windowTokens ?? 0)} window · ${formatTokensShort(stats.spentTokens)} spent`
		: undefined;
	const withState = action !== undefined ? displaySafe(`${baseLabel} [${action.replace(/^fsm:/, "")}]`) || baseLabel : baseLabel;
	const label = usage !== undefined ? `${withState} · ${usage}` : withState;
	return {
		id: view.sessionId,
		// Registry rows are scoped to the owning root session; both the status
		// widget and the inspector snapshot the current session's registry slice.
		sessionId: ownerSessionId,
		source: SOURCE,
		label: label.slice(0, 160),
		state: view.runActive ? "running"
			: view.lifecycle === "failed" || view.outcome === "failed" ? "failed"
			: view.outcome === "cancelled" ? "stopped"
			: "completed",
		startedAt: stats.firstTs ?? now,
		...(stats.lastTs !== null ? { updatedAt: stats.lastTs, ...(view.runActive ? {} : { endedAt: stats.lastTs }) } : {}),
		...(action !== undefined ? { currentAction: action } : {}),
		...(preview !== undefined && preview !== "" ? { preview } : {}),
		transcriptPath: view.sessionFile,
	};
}

/**
 * The vendor TUI reads only the fields below from SubagentState. The cast is a
 * decided invariant: the vendor type describes its full extension lifecycle,
 * which this host never runs. test/nico-fleet-adapter.test.ts pins the field
 * list against the vendor sources so a view update cannot silently read a
 * field we do not supply.
 */
export function buildNicoFleetState(deps: NicoFleetDeps): SubagentState {
	return {
		baseCwd: deps.baseCwd,
		currentSessionId: deps.rootSessionId,
		parentSessionFile: deps.rootSessionFile?.() ?? null,
		asyncJobs: new Map(),
		widgetsSuspended: false,
		fleetInspectorOpen: false,
		foregroundControls: new Map(),
		workflowControllers: new Map(),
	} as unknown as SubagentState;
}

/** Reconciles the registry with the live child list: register new, update changed, drop vanished. */
export async function refreshNicoFleetRuns(deps: NicoFleetDeps, published: Map<string, ExternalRun>, readers: Map<string, SessionStatsReader>): Promise<void> {
	const views = deps.fleet().list();
	const actors = await deps.actors().catch(() => [] as readonly FleetActorFact[]);
	const actorByKey = new Map(actors.map((actor) => [actor.agentId, actor]));
	const next = new Map<string, ExternalRun>();
	for (const view of views) {
		let reader = readers.get(view.sessionId);
		if (!reader) {
			reader = new SessionStatsReader(deps.contextWindowOf(view.model));
			readers.set(view.sessionId, reader);
		}
		const stats = await reader.advance(view.sessionFile);
		const preview = await livePreview(view.sessionFile);
		next.set(view.sessionId, toExternalRun(view, actorByKey.get(view.sessionId), stats, deps.rootSessionId, preview));
	}
	for (const run of next.values()) {
		const previous = published.get(run.id);
		if (!previous) registerExternalRun(run);
		else {
			// updateExternalRun rejects the immutable id/sessionId/source fields.
			const { id: _id, sessionId: _sessionId, source: _source, ...update } = run;
			updateExternalRun(run.sessionId, run.id, update);
		}
	}
	for (const id of published.keys()) {
		if (!next.has(id)) unregisterExternalRun(published.get(id)!.sessionId, id);
	}
	published.clear();
	for (const [id, run] of next) published.set(id, run);
}

/** Steer rides the HC message bus; stop kicks the child's abort without blocking the view. */
export function buildNicoFleetActions(deps: NicoFleetDeps): FleetActionHandlers {
	return {
		steer: async ({ runId, message }) => {
			try {
				await deps.fleet().send(runId, message);
				return { text: `steered ${runId}` };
			} catch (error) {
				return { text: String(error), isError: true };
			}
		},
		stop: ({ runId }) => {
			void deps.abortChild(runId).catch(() => {});
			return { text: `stop requested: ${runId}` };
		},
	};
}

export interface NicoFleetPublisher {
	readonly state: SubagentState;
	refresh(): Promise<void>;
	stop(): void;
}

/** Owns the shared state and keeps the external-run registry in step with the live children. */
export function startNicoFleetPublisher(deps: NicoFleetDeps): NicoFleetPublisher {
	const state = buildNicoFleetState(deps);
	const published = new Map<string, ExternalRun>();
	const readers = new Map<string, SessionStatsReader>();
	let refreshing = false;
	let stopped = false;
	const refresh = async (): Promise<void> => {
		if (refreshing || stopped) return;
		refreshing = true;
		try {
			await refreshNicoFleetRuns(deps, published, readers);
		} catch {
			// keep the last snapshot; the next tick retries
		} finally {
			refreshing = false;
		}
	};
	const timer = setInterval(() => {
		void refresh();
	}, PUBLISH_MS);
	const unsubscribe = deps.fleet().subscribe(() => {
		void refresh();
	});
	void refresh();
	return {
		state,
		refresh,
		stop(): void {
			stopped = true;
			clearInterval(timer);
			unsubscribe();
			for (const [id, run] of published) unregisterExternalRun(run.sessionId, id);
			published.clear();
		},
	};
}

/** Opens the vendor fleet inspector over the publisher's live state. */
export async function openNicoFleet(ctx: ExtensionContext, deps: NicoFleetDeps, publisher: NicoFleetPublisher, initialSessionId: string): Promise<void> {
	await openSubagentFleet(ctx, publisher.state, { initialKey: `external:${initialSessionId}`, actions: buildNicoFleetActions(deps) });
}

/**
 * Mounts the vendor fleet status widget: it renders the registry rows (FSM
 * state included) and opens the vendor inspector on selection. Replaces the
 * hand-rolled selector widget entirely.
 */
export function registerNicoFleetStatus(pi: ExtensionAPI, ctx: ExtensionContext, options: NicoFleetStatusOptions): () => void {
	void pi;
	if (!ctx.hasUI) return () => {};
	const publisher = startNicoFleetPublisher(options);
	const status = new SubagentFleetStatus(publisher.state, (itemKey) => {
		const id = itemKey.startsWith("external:") ? itemKey.slice("external:".length) : options.fleet().list()[0]?.sessionId;
		if (id === undefined) return undefined;
		return openNicoFleet(ctx, options, publisher, id);
	}, { placement: options.placement });
	status.setContext(ctx);
	return () => {
		status.dispose();
		publisher.stop();
	};
}
