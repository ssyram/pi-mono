import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeDisplayText } from "./sanitize-display-text.js";
import type { FooterStats, FooterTheme } from "./footer-stats.js";

export function layoutFooter(
	path: string,
	stats: FooterStats,
	statuses: ReadonlyMap<string, string>,
	providerCount: number,
	width: number,
	theme: FooterTheme,
): string[] {
	let left = stats.left;
	let leftWidth = visibleWidth(left);
	if (leftWidth > width) {
		left = truncateToWidth(left, width, "...");
		leftWidth = visibleWidth(left);
	}
	let right = stats.rightWithoutProvider;
	if (providerCount > 1 && stats.provider) {
		const withProvider = `(${stats.provider}) ${right}`;
		if (leftWidth + 2 + visibleWidth(withProvider) <= width) right = withProvider;
	}
	const rightWidth = visibleWidth(right);
	let statsLine: string;
	if (leftWidth + 2 + rightWidth <= width) {
		statsLine = left + " ".repeat(Math.max(0, width - leftWidth - rightWidth)) + right;
	} else {
		const availableForRight = width - leftWidth - 2;
		if (availableForRight > 0) {
			const truncated = truncateToWidth(right, availableForRight, "");
			statsLine = left + " ".repeat(Math.max(0, width - leftWidth - visibleWidth(truncated))) + truncated;
		} else {
			statsLine = left;
		}
	}
	const dimmedLeft = theme.fg("dim", left);
	const dimmedRemainder = theme.fg("dim", statsLine.slice(left.length));
	const pathLine = truncateToWidth(theme.fg("dim", path), width, theme.fg("dim", "..."));
	const lines = [pathLine, dimmedLeft + dimmedRemainder];
	if (statuses.size > 0) {
		const statusLine = Array.from(statuses.entries())
			.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
			.map(([, text]) => sanitizeDisplayText(text))
			.join(" ");
		lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
	}
	return lines;
}
