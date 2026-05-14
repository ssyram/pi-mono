import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

export interface DockerSection {
	id: string;
	title: string;
	/** Lower = higher on screen. */
	order: number;
	/** Content lines. Each line should already be formatted for the overlay width. */
	lines: string[];
}

export const DOCKER_MAX_HEIGHT_PERCENT = 70;
export const DOCKER_MIN_CONTENT_LINES = 12;

const BOX_CHROME_ROWS = 3;
const DOCKER_MAX_HEIGHT_RATIO = DOCKER_MAX_HEIGHT_PERCENT / 100;

export class DockerComponent implements Component {
	private sections = new Map<string, DockerSection>();
	private scrollOffset = 0;
	private lastInnerW = 26; // default estimate (minWidth 28 - 2 borders), updated each render

	constructor(
		private theme: Theme,
		private tui: Pick<TUI, "requestRender" | "terminal">,
	) {}

	updateSection(section: DockerSection): void {
		this.sections.set(section.id, section);
		this.tui.requestRender();
	}

	removeSection(id: string): void {
		this.sections.delete(id);
		const allLines = this.buildWrappedLines(this.lastInnerW);
		this.clampScroll(this.getBodyRows(), allLines.length);
		this.tui.requestRender();
	}

	clear(): void {
		this.sections.clear();
		this.scrollOffset = 0;
		this.tui.requestRender();
	}

	invalidate(): void {
		// No cached state
	}

	private getOverlayHeight(): number {
		return Math.max(1, Math.floor(this.tui.terminal.rows * DOCKER_MAX_HEIGHT_RATIO));
	}

	private getBodyRows(totalRows = this.getOverlayHeight()): number {
		return Math.max(0, totalRows - BOX_CHROME_ROWS);
	}

	private canRenderContent(totalRows = this.getOverlayHeight()): boolean {
		return this.getBodyRows(totalRows) >= DOCKER_MIN_CONTENT_LINES;
	}

	private clampScroll(maxLines: number, totalLines: number): void {
		const maxScroll = Math.max(0, totalLines - Math.max(1, maxLines));
		if (this.scrollOffset > maxScroll) {
			this.scrollOffset = maxScroll;
		}
		if (this.scrollOffset < 0) {
			this.scrollOffset = 0;
		}
	}

	private padRow(text: string, innerW: number): string {
		const clipped = truncateToWidth(text, innerW, "…", true);
		const vis = visibleWidth(clipped);
		return clipped + " ".repeat(Math.max(0, innerW - vis));
	}

	private buildAllLines(innerW: number): string[] {
		const th = this.theme;
		const lines: string[] = [];

		// Sort sections by order
		const sorted = Array.from(this.sections.values()).sort((a, b) => a.order - b.order);

		for (let i = 0; i < sorted.length; i++) {
			const section = sorted[i];

			// Section title (separator line)
			if (i > 0) {
				lines.push(th.fg("borderMuted", "─".repeat(innerW)));
			}
			lines.push(th.fg("accent", `▸ ${section.title}`));

			// Section content
			for (const line of section.lines) {
				lines.push(line);
			}
		}

		return lines;
	}

	private buildWrappedLines(innerW: number): string[] {
		const raw = this.buildAllLines(innerW);
		const wrapped: string[] = [];
		for (const line of raw) {
			if (visibleWidth(line) <= innerW) {
				wrapped.push(line);
			} else {
				wrapped.push(...wrapTextWithAnsi(line, innerW));
			}
		}
		return wrapped;
	}

	private buildWarningLines(bodyRows: number): string[] {
		const th = this.theme;
		return [
			th.fg("warning", "⚠ Docker height too small"),
			th.fg("dim", `Need >= ${DOCKER_MIN_CONTENT_LINES} content rows`),
			th.fg("dim", `Current: ${bodyRows}`),
			th.fg("dim", "Resize terminal taller"),
		].slice(0, bodyRows);
	}

	private getVisibleRange(
		bodyRows: number,
		totalLines: number,
		showContent: boolean,
	): { start: number; end: number; total: number } {
		if (!showContent || totalLines === 0) {
			return { start: 0, end: 0, total: totalLines };
		}

		return {
			start: this.scrollOffset + 1,
			end: Math.min(this.scrollOffset + bodyRows, totalLines),
			total: totalLines,
		};
	}

	private renderTinyWarning(width: number, totalRows: number): string[] {
		const th = this.theme;
		return [
			th.fg("warning", "⚠ Docker height too small"),
			th.fg("dim", `Need >= ${DOCKER_MIN_CONTENT_LINES} content rows`),
		]
			.slice(0, totalRows)
			.map((line) => truncateToWidth(line, Math.max(1, width), "…", true));
	}

	render(width: number): string[] {
		const th = this.theme;
		const totalRows = this.getOverlayHeight();

		if (totalRows < BOX_CHROME_ROWS) {
			return this.renderTinyWarning(width, totalRows);
		}

		const innerW = Math.max(1, width - 2); // Account for box borders
		this.lastInnerW = innerW;
		const bodyRows = this.getBodyRows(totalRows);
		const showContent = this.canRenderContent(totalRows);
		const allLines = this.buildWrappedLines(innerW);
		const totalLines = allLines.length;

		if (showContent) {
			this.clampScroll(bodyRows, totalLines);
		}

		const visibleLines = showContent
			? allLines.slice(this.scrollOffset, this.scrollOffset + bodyRows)
			: this.buildWarningLines(bodyRows);
		const visibleRange = this.getVisibleRange(bodyRows, totalLines, showContent);

		// Build box
		const result: string[] = [];

		// Top border with title
		const title = truncateToWidth(" Docker [ ctrl+shift+p/n scroll ]", innerW, "…", true);
		const titleVis = visibleWidth(title);
		const leftPad = Math.max(0, Math.floor((innerW - titleVis) / 2));
		const rightPad = Math.max(0, innerW - titleVis - leftPad);
		result.push(th.fg("border", "╭" + "─".repeat(leftPad)) + th.fg("accent", title) + th.fg("border", "─".repeat(rightPad) + "╮"));

		// Status line
		const status = showContent
			? totalLines > 0
				? ""
				: " empty "
			: ` too short ${bodyRows}/${DOCKER_MIN_CONTENT_LINES} `;
		result.push(
			th.fg("border", "│") +
				th.fg(showContent ? "dim" : "warning", this.padRow(status, innerW)) +
				th.fg("border", "│"),
		);

		// Body lines
		for (const line of visibleLines) {
			result.push(th.fg("border", "│") + this.padRow(line, innerW) + th.fg("border", "│"));
		}

		// Fill empty space to match the current visible height budget
		const emptyRows = bodyRows - visibleLines.length;
		for (let i = 0; i < emptyRows; i++) {
			result.push(th.fg("border", "│") + " ".repeat(innerW) + th.fg("border", "│"));
		}

		// Bottom border with visible range status
		const rangeLabel = ` [${visibleRange.start} - ${visibleRange.end} / ${visibleRange.total}] `;
		const rangeClipped = truncateToWidth(rangeLabel, innerW, "…", true);
		const rangeVis = visibleWidth(rangeClipped);
		const rangeLeft = Math.max(0, Math.floor((innerW - rangeVis) / 2));
		const rangeRight = Math.max(0, innerW - rangeVis - rangeLeft);
		const rangePadded = "─".repeat(rangeLeft) + rangeClipped + "─".repeat(rangeRight);
		result.push(
			th.fg("border", "╰") +
				th.fg(showContent ? "dim" : "warning", rangePadded) +
				th.fg("border", "╯"),
		);

		return result;
	}

	scrollUp(lines = 1): void {
		if (!this.canRenderContent()) return;
		this.scrollOffset = Math.max(0, this.scrollOffset - lines);
		this.tui.requestRender();
	}

	scrollDown(lines = 1): void {
		if (!this.canRenderContent()) return;
		const allLines = this.buildWrappedLines(this.lastInnerW);
		const maxScroll = Math.max(0, allLines.length - this.getBodyRows());
		this.scrollOffset = Math.min(maxScroll, this.scrollOffset + lines);
		this.tui.requestRender();
	}

	scrollToTop(): void {
		if (!this.canRenderContent()) return;
		this.scrollOffset = 0;
		this.tui.requestRender();
	}

	scrollToBottom(): void {
		if (!this.canRenderContent()) return;
		const allLines = this.buildWrappedLines(this.lastInnerW);
		const maxScroll = Math.max(0, allLines.length - this.getBodyRows());
		this.scrollOffset = maxScroll;
		this.tui.requestRender();
	}
}
