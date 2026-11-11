import { formatLocalTime } from "./format-local-time.js";
import { sanitizeDisplayText } from "./sanitize-display-text.js";
import type { CodexUsage, CodexUsageWindow } from "./codex-usage.js";

function formatDuration(windowSeconds: number | undefined, group: CodexUsageWindow["group"]): string {
	if (windowSeconds === undefined) return group === "primary" ? "main window" : "secondary window";
	if (windowSeconds === 18_000) return "5h";
	if (windowSeconds === 604_800) return "week";
	if (windowSeconds % 86_400 === 0) return `${windowSeconds / 86_400}d`;
	if (windowSeconds % 3_600 === 0) return `${windowSeconds / 3_600}h`;
	if (windowSeconds % 60 === 0) return `${windowSeconds / 60}m`;
	return `${windowSeconds}s`;
}

function formatWindow(item: CodexUsageWindow): string {
	const label = item.label ? `${sanitizeDisplayText(item.label)} ` : "";
	const secondary = item.group === "secondary" && item.label ? "secondary " : "";
	const reset = item.window.resetAt === undefined ? "" : `, resets ${formatLocalTime(item.window.resetAt * 1000)}`;
	return `${label}${secondary}${item.window.usedPercent}%(${formatDuration(item.window.windowSeconds, item.group)}) used${reset}`;
}

export function formatCodexCompact(data: CodexUsage): string {
	const windows = data.windows.filter((item) => !item.label);
	const shown = (windows.length > 0 ? windows : data.windows).slice(0, 2);
	if (shown.length > 0) {
		return sanitizeDisplayText(shown.map((item) => {
			const label = item.label ? `${sanitizeDisplayText(item.label)} ` : "";
			return `${label}${item.window.usedPercent}%(${formatDuration(item.window.windowSeconds, item.group)})`;
		}).join(", "));
	}
	return data.credit?.kind === "unlimited" ? "credits unlimited" : `credits ${data.credit?.balance ?? "?"}`;
}

export function formatCodex(data: CodexUsage): string {
	const parts = data.windows.map(formatWindow);
	if (data.credit?.kind === "unlimited") parts.push("credits unlimited");
	if (data.credit?.kind === "balance") parts.push(`credits ${data.credit.balance}`);
	if (data.partial) parts.push("some fields unparsed");
	return sanitizeDisplayText(parts.join(", "));
}
