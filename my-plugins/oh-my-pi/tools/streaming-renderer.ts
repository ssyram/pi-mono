/**
 * streaming-renderer.ts — shared renderResult logic for call-agent and delegate-task.
 *
 * Renders both streaming (isPartial) and completed states, matching
 * the official pi subagent TUI experience.
 */

import { getMarkdownTheme, type Theme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Component } from "@mariozechner/pi-tui";
import { formatToolCall, formatUsageStats } from "./format-tool-call.js";
import type { StreamingDetails } from "./streaming-accumulator.js";

const COLLAPSED_ITEM_COUNT = 10;

// ─── Display item rendering ─────────────────────────────────────────────────

function renderDisplayItems(
	details: StreamingDetails,
	theme: Theme,
	limit?: number,
): string[] {
	const items = details.items;
	const startIdx = limit && items.length > limit ? items.length - limit : 0;
	const lines: string[] = [];

	if (startIdx > 0) {
		lines.push(theme.fg("dim", `  ... ${startIdx} earlier items`));
	}

	const themeFg = theme.fg.bind(theme);
	for (let i = startIdx; i < items.length; i++) {
		const item = items[i];
		if (item.type === "toolCall") {
			lines.push("  " + theme.fg("muted", "\u2192 ") + formatToolCall(item.name, item.args, themeFg));
		} else if (item.type === "text") {
			const preview = item.text.split("\n").slice(0, 3).join("\n");
			const truncated = preview.length < item.text.length ? preview + "..." : preview;
			lines.push("  " + theme.fg("toolOutput", truncated));
		}
		// toolResult items are implicit (shown by next tool call or final output)
	}

	// Show current streaming text if present
	if (details.currentText) {
		const preview = details.currentText.split("\n").slice(0, 3).join("\n");
		const truncated = preview.length < details.currentText.length ? preview + "..." : preview;
		lines.push("  " + theme.fg("toolOutput", truncated));
	}

	return lines;
}

// ─── Status icon ─────────────────────────────────────────────────────────────

function statusIcon(details: StreamingDetails, theme: Theme): string {
	switch (details.status) {
		case "running": return theme.fg("warning", "\u27F3 ");
		case "completed": return theme.fg("success", "\u2713 ");
		case "error": return theme.fg("error", "\u2717 ");
	}
}

// ─── Main render function ───────────────────────────────────────────────────

export function renderStreamingResult(
	result: AgentToolResult<StreamingDetails>,
	options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
): Component {
	const details = result.details;
	if (!details) {
		// Fallback for non-streaming results
		const t = result.content[0];
		const text = t?.type === "text" ? t.text : "";
		return new Text(theme.fg("muted", text), 0, 0);
	}

	const icon = statusIcon(details, theme);
	const agentLabel = theme.bold(details.agent);
	const modelLabel = theme.fg("dim", ` (${details.model})`);
	const usageLine = formatUsageStats(details.usage, details.model);

	// ── Expanded view ──────────────────────────────────────────────────────
	if (options.expanded) {
		return renderExpanded(details, icon, agentLabel, modelLabel, usageLine, theme);
	}

	// ── Collapsed view ─────────────────────────────────────────────────────
	return renderCollapsed(details, icon, agentLabel, modelLabel, usageLine, theme);
}

// ─── Collapsed view ──────────────────────────────────────────────────────────

function renderCollapsed(
	details: StreamingDetails,
	icon: string,
	agentLabel: string,
	modelLabel: string,
	usageLine: string,
	theme: Theme,
): Component {
	const lines: string[] = [];

	// Header line
	let header = icon + agentLabel + modelLabel;
	if (details.error) {
		header += " " + theme.fg("error", details.error.slice(0, 60));
	}
	lines.push(header);

	// Display items (last N)
	const itemLines = renderDisplayItems(details, theme, COLLAPSED_ITEM_COUNT);
	lines.push(...itemLines);

	// Expand hint if there are more items
	if (details.items.length > COLLAPSED_ITEM_COUNT) {
		lines.push(theme.fg("dim", "  (Ctrl+O to expand)"));
	}

	// Usage stats
	if (usageLine) {
		lines.push(theme.fg("dim", "  " + usageLine));
	}

	return new Text(lines.join("\n"), 0, 0);
}

// ─── Expanded view ───────────────────────────────────────────────────────────

function renderExpanded(
	details: StreamingDetails,
	icon: string,
	agentLabel: string,
	modelLabel: string,
	usageLine: string,
	theme: Theme,
): Component {
	const container = new Container();
	const mdTheme = getMarkdownTheme();

	// Header
	let header = icon + agentLabel + modelLabel;
	if (details.error) {
		header += "\n" + theme.fg("error", details.error);
	}
	container.addChild(new Text(header, 0, 0));

	// Output section
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("dim", "\u2500\u2500\u2500 Output \u2500\u2500\u2500"), 0, 0));

	// All tool call items
	const themeFg = theme.fg.bind(theme);
	for (const item of details.items) {
		if (item.type === "toolCall") {
			container.addChild(new Text(
				theme.fg("muted", "\u2192 ") + formatToolCall(item.name, item.args, themeFg),
				0, 0,
			));
		}
	}

	// Final text output as Markdown
	const finalText = getFinalText(details);
	if (finalText) {
		container.addChild(new Markdown(finalText.trim(), 0, 0, mdTheme));
	}

	// Usage stats
	container.addChild(new Spacer(1));
	if (usageLine) {
		container.addChild(new Text(theme.fg("dim", usageLine), 0, 0));
	}

	return container;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFinalText(details: StreamingDetails): string {
	// Use current streaming text if still running
	if (details.currentText) return details.currentText;
	// Otherwise use last text display item
	for (let i = details.items.length - 1; i >= 0; i--) {
		const item = details.items[i];
		if (item.type === "text") return item.text;
	}
	return "";
}
