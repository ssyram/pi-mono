import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FleetChildView, FleetView } from "../subagents/hc-fleet-view.ts";
import { buildFleetTree, clampTopForSelection, flattenVisible, windowRows, type FleetLine } from "./fleet-tree.ts";
import { SessionStatsReader, elapsedTextMs, type ChildStats } from "./fleet-stats.ts";
import { identityStyle, renderFleetRow, renderOverflowLine, terminalMark, formatTokens } from "./fleet-row-format.ts";

export interface FleetUiOptions {
	readonly placement: "aboveEditor" | "belowEditor";
	readonly fleet: () => FleetView;
	readonly contextWindowOf: (model: string) => number | null;
	readonly rootSessionId: string;
	/** Real root transcript path when the host exposes it; absent hosts state that honestly. */
	readonly rootSessionFile?: () => string | undefined;
	/** Daemon actor facts for the row's FSM state and no-progress counter. */
	readonly actors: () => Promise<ReadonlyArray<{ agentId: string; fsmName: string; stateId: string; noProgress: number }>>;
}

const WIDGET_KEY = "fsm-compatible-fleet";
const TICK_MS = 500;

type Phase = "idle" | "selector";

/** One-line persistent summary: `↓ 3 run / 5 done` above the editor; empty when no children exist. */
function summaryLine(list: readonly FleetChildView[]): string {
	if (list.length === 0) return "";
	const running = list.filter((view) => view.runActive || view.lifecycle === "starting").length;
	const done = list.length - running;
	return `↓ ${running} run / ${done} done`;
}

export function registerFleetUI(pi: ExtensionAPI, ctx: ExtensionContext, options: FleetUiOptions): () => void {
	let phase: Phase = "idle";
	let selected = options.rootSessionId;
	const expanded = new Set<string>();
	let top = 0;
	let list: readonly FleetChildView[] = [];
	let actors: ReadonlyArray<{ agentId: string; fsmName: string; stateId: string; noProgress: number }> = [];
	const readers = new Map<string, SessionStatsReader>();
	let tuiRef: TUI | undefined;
	let themeRef: Theme | undefined;
	let cacheKey = "";
	let cacheWidth = 0;
	let cacheLines: string[] = [];
	let timer: NodeJS.Timeout | undefined;

	const editorHasFocus = () => {
		if (!tuiRef) return true;
		const focused = (tuiRef as unknown as { focusedComponent?: unknown }).focusedComponent;
		if (!focused || typeof focused !== "object") return false;
		const candidate = focused as { render?: unknown; invalidate?: unknown; handleInput?: unknown; getText?: unknown; setText?: unknown };
		return typeof candidate.render === "function" && typeof candidate.invalidate === "function"
			&& typeof candidate.handleInput === "function" && typeof candidate.getText === "function" && typeof candidate.setText === "function";
	};

	const flatRows = () => flattenVisible(buildFleetTree(list.map((view) => ({ sessionId: view.sessionId, parentSessionId: view.parentSessionId, name: view.name, runActive: view.runActive })), options.rootSessionId), expanded);

	const statsFor = (view: FleetChildView): ChildStats => {
		let reader = readers.get(view.sessionId);
		if (!reader) { reader = new SessionStatsReader(options.contextWindowOf(view.model)); readers.set(view.sessionId, reader); }
		return reader.stats;
	};

	const markOf = (view: FleetChildView | undefined) => view ? terminalMark(view.outcome, view.runActive) : null;

	const renderWidget = (width: number): string[] => {
		const flat = flatRows();
		top = clampTopForSelection(flat, selected, top);
		const { lines } = windowRows(flat, top);
		const viewByKey = new Map(list.map((view) => [view.sessionId, view]));
		const actorByKey = new Map(actors.map((actor) => [actor.agentId, actor]));
		const now = Date.now();
		const rendered: string[] = [];
		for (const line of lines as FleetLine[]) {
			if (line.kind !== "entry") { rendered.push(renderOverflowLine(line.kind === "overflow-above" ? "above" : "below", line.hidden, themeRef)); continue; }
			const { node } = line.row;
			if (node.depth === 0) {
				rendered.push(renderFleetRow({ row: line.row, selected: node.key === selected, ctxText: "—", elapsedText: "—",
					tokensText: "—", mark: null, width, theme: themeRef }));
				continue;
			}
			const view = viewByKey.get(node.key);
			const actor = actorByKey.get(node.key);
			const stats = view ? statsFor(view) : { totalTokens: 0, ctxPercent: null, firstTs: null, lastTs: null };
			const mark = markOf(view);
			const fsm = actor ? `${actor.fsmName}:${actor.stateId}${actor.noProgress > 0 ? `⏱${actor.noProgress}` : ""}` : "—";
			rendered.push(renderFleetRow({ row: line.row, selected: node.key === selected,
				ctxText: mark !== null ? fsm : stats.ctxPercent === null ? fsm : `${fsm} ${stats.ctxPercent}%`,
				elapsedText: elapsedTextMs(stats, now, mark !== null),
				tokensText: view ? formatTokens(stats.totalTokens) : "—", mark, width, theme: themeRef }));
		}
		return rendered;
	};

	const widgetComponent = {
		render(width: number): string[] {
			if (phase === "idle") {
				// No children → no widget content at all.
				const summary = summaryLine(list);
				return summary ? [summary] : [];
			}
			const key = JSON.stringify([list.map((view) => [view.sessionId, view.outcome, view.runActive]), actors, selected, [...expanded], top,
				[...readers.entries()].map(([id, reader]) => [id, reader.stats.totalTokens, reader.stats.ctxPercent, reader.stats.lastTs])]);
			if (key === cacheKey && cacheWidth === width) return cacheLines;
			cacheKey = key; cacheWidth = width;
			cacheLines = renderWidget(width);
			return cacheLines;
		},
		invalidate(): void { cacheKey = ""; },
	};

	const mountWidget = (mount: boolean) => {
		if (mount) ctx.ui.setWidget(WIDGET_KEY, (tui: TUI, theme: Theme) => {
			tuiRef = tui; themeRef = theme;
			return { ...widgetComponent, dispose: () => { if (tuiRef === tui) tuiRef = undefined; } };
		}, { placement: options.placement });
		else ctx.ui.setWidget(WIDGET_KEY, undefined);
	};

	const tick = async () => {
		try {
			list = options.fleet().list();
			actors = await options.actors().catch(() => []);
			if (phase !== "idle") {
				await Promise.all(list.map(async (view) => { await readers.get(view.sessionId)?.advance(view.sessionFile); }));
			}
			cacheKey = "";
			tuiRef?.requestRender();
		} catch { /* keep last render */ }
	};

	const showSelector = () => {
		phase = "selector"; mountWidget(true); void tick();
		if (!timer) timer = setInterval(() => void tick(), TICK_MS);
	};
	const hideSelector = () => {
		phase = "idle"; cacheKey = "";
		if (timer) { clearInterval(timer); timer = undefined; }
		mountWidget(true); // remount for the summary-line factory to rebind
	};

	const moveSelection = (delta: number) => {
		const flat = flatRows();
		if (flat.length === 0) return;
		const index = flat.findIndex((row) => row.node.key === selected);
		const next = Math.max(0, Math.min(flat.length - 1, (index < 0 ? 0 : index) + delta));
		selected = flat[next]!.node.key;
		top = clampTopForSelection(flat, selected, top);
		cacheKey = "";
		tuiRef?.requestRender();
	};

	const activateRow = () => {
		if (selected === options.rootSessionId) {
			const file = options.rootSessionFile?.();
			ctx.ui.notify(file ? `main session — transcript ${file}` : "main session — no transcript in this host", "info");
			return;
		}
		const view = list.find((item) => item.sessionId === selected);
		if (!view) return;
		ctx.ui.notify(`transcript: ${view.sessionFile}`, "info");
	};

	const onInputKey = (data: string): { consume: boolean } | undefined => {
		if (isKeyRelease(data) || !editorHasFocus()) return undefined;
		if (ctx.ui.getEditorText() !== "") return undefined;
		if (phase === "idle") {
			if (matchesKey(data, "down") || matchesKey(data, "left")) {
				list = options.fleet().list();
				if (list.length > 0) { selected = list[0]!.sessionId; showSelector(); return { consume: true }; }
			}
			return undefined;
		}
		if (matchesKey(data, "escape")) { hideSelector(); return { consume: true }; }
		if (matchesKey(data, "up") || matchesKey(data, "k")) { moveSelection(-1); return { consume: true }; }
		if (matchesKey(data, "down") || matchesKey(data, "j")) { moveSelection(1); return { consume: true }; }
		if (matchesKey(data, "right")) { if (!expanded.has(selected)) { expanded.add(selected); cacheKey = ""; tuiRef?.requestRender(); } return { consume: true }; }
		if (matchesKey(data, "left")) { if (expanded.has(selected)) { expanded.delete(selected); cacheKey = ""; tuiRef?.requestRender(); } return { consume: true }; }
		if (matchesKey(data, Key.enter)) { activateRow(); return { consume: true }; }
		return undefined;
	};

	const offTerminal = ctx.ui.onTerminalInput((data) => {
		try { return onInputKey(data); } catch { return undefined; }
	});
	// Event-driven: child lifecycle events invalidate the summary; timer only for selector elapsed/ctx.
	const offEvents = options.fleet().subscribe(() => { void tick(); });
	mountWidget(true);
	void tick();
	return () => { offEvents(); if (timer) { clearInterval(timer); timer = undefined; } mountWidget(false); offTerminal(); };
}

export type { FleetChildView, FleetView };
void identityStyle;
