import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FleetFlatRow } from "./fleet-tree.ts";

export type FleetTheme = {
	fg(style: "accent" | "dim" | "muted" | "error" | "warning", text: string): string;
};

export function formatTokens(value: number): string {
	if (value < 1000) return `${Math.round(value)}`;
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
	return `${(value / 1_000_000).toFixed(1)}M`;
}

export function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

export function identityStyle(theme: FleetTheme | undefined, name: string, styles: readonly NonNullable<Parameters<FleetTheme["fg"]>[0]>[] = ["accent", "dim"]): (text: string) => string {
	const style = styles[fnv1a(name) % styles.length] ?? "accent";
	return theme ? (text) => theme.fg(style, text) : (text) => text;
}

export type TerminalMark = "done" | "failed" | "crashed" | "aborted" | null;

export function terminalMark(outcome: string | null, lifecycleRunActive: boolean): TerminalMark {
	if (lifecycleRunActive) return null;
	if (outcome === "completed") return "done";
	if (outcome === "failed") return "failed";
	if (outcome === "crashed") return "crashed";
	if (outcome === "aborted") return "aborted";
	return null;
}

const MARK_TEXT: Record<Exclude<TerminalMark, null>, string> = { done: "✓done", failed: "✗failed", crashed: "✗crashed", aborted: "⏹aborted" };

export function renderFleetRow(options: {
	row: FleetFlatRow;
	selected: boolean;
	ctxText: string;
	elapsedText: string;
	tokensText: string;
	mark: TerminalMark;
	width: number;
	theme: FleetTheme | undefined;
}): string {
	const { row, selected, width, theme } = options;
	const indent = "  ".repeat(row.node.depth);
	const marker = row.node.depth === 0 ? "- " : row.hasChildren ? (row.expanded ? "▾ " : "▸ ") : "  ";
	const hint = row.hasChildren ? (row.expanded ? "" : ` (${row.node.children.length}, ->)`) : "";
	const left = `${indent}${marker}${row.node.name}${row.node.depth === 0 ? "" : ` ${row.node.shortId}`}${hint}`;
	const ctx = options.mark === null ? options.ctxText : MARK_TEXT[options.mark];
	const right = ` ${ctx.padStart(4)} ${options.elapsedText.padStart(6)} ${options.tokensText.padStart(6)}`;
	const leftWidth = Math.max(1, width - visibleWidth(right) - 1);
	const body = `${selected ? theme?.fg("accent", ">") ?? ">" : " "}${truncateToWidth(left, leftWidth)}`;
	return `${body}${right}`;
}

export function renderOverflowLine(kind: "above" | "below", hidden: number, theme: FleetTheme | undefined): string {
	const text = kind === "above" ? `(上方 ${hidden} 条)` : `(下方 ${hidden} 条)`;
	return theme ? theme.fg("dim", text) : text;
}
