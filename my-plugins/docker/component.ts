import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { DockerSection } from "./protocol.js";

export class DockerComponent implements Component {
	private sections = new Map<string, DockerSection>();
	private scrollOffset = 0;
	private maxLines = 30; // Will be updated based on terminal height

	constructor(
		private theme: Theme,
		private tui: { requestRender: () => void },
	) {}

	setMaxLines(lines: number): void {
		this.maxLines = Math.max(5, lines);
	}

	updateSection(section: DockerSection): void {
		this.sections.set(section.id, section);
		this.tui.requestRender();
	}

	removeSection(id: string): void {
		this.sections.delete(id);
		// Adjust scroll if we're past the end
		const allLines = this.buildAllLines();
		const maxScroll = Math.max(0, allLines.length - this.maxLines);
		if (this.scrollOffset > maxScroll) {
			this.scrollOffset = maxScroll;
		}
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

	private buildAllLines(): string[] {
		const th = this.theme;
		const lines: string[] = [];

		// Sort sections by order
		const sorted = Array.from(this.sections.values()).sort((a, b) => a.order - b.order);

		for (let i = 0; i < sorted.length; i++) {
			const section = sorted[i];

			// Section title (separator line)
			if (i > 0) {
				lines.push(th.fg("borderMuted", "─".repeat(80))); // Will be truncated by render
			}
			lines.push(th.fg("accent", `▸ ${section.title}`));

			// Section content
			for (const line of section.lines) {
				lines.push(line);
			}
		}

		return lines;
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = width - 2; // Account for box borders

		const allLines = this.buildAllLines();
		const totalLines = allLines.length;

		// Clamp scroll
		const maxScroll = Math.max(0, totalLines - this.maxLines);
		if (this.scrollOffset > maxScroll) {
			this.scrollOffset = maxScroll;
		}
		if (this.scrollOffset < 0) {
			this.scrollOffset = 0;
		}

		// Slice visible window
		const visibleLines = allLines.slice(this.scrollOffset, this.scrollOffset + this.maxLines);

		// Build box
		const result: string[] = [];

		// Top border with title
		const title = " Docker ";
		const titleVis = visibleWidth(title);
		const leftPad = Math.max(0, Math.floor((innerW - titleVis) / 2));
		const rightPad = Math.max(0, innerW - titleVis - leftPad);
		result.push(th.fg("border", "╭" + "─".repeat(leftPad)) + th.fg("accent", title) + th.fg("border", "─".repeat(rightPad) + "╮"));

		// Scroll info line
		if (totalLines > 0) {
			const scrollInfo = ` ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + this.maxLines, totalLines)}/${totalLines} `;
			const infoVis = visibleWidth(scrollInfo);
			result.push(th.fg("border", "│") + th.fg("dim", scrollInfo + " ".repeat(Math.max(0, innerW - infoVis))) + th.fg("border", "│"));
		}

		// Content lines
		for (const line of visibleLines) {
			const truncated = truncateToWidth(line, innerW, "…", true);
			const vis = visibleWidth(truncated);
			const padded = truncated + " ".repeat(Math.max(0, innerW - vis));
			result.push(th.fg("border", "│") + padded + th.fg("border", "│"));
		}

		// Fill empty space if content is shorter than maxLines
		const emptyRows = this.maxLines - visibleLines.length;
		for (let i = 0; i < emptyRows; i++) {
			result.push(th.fg("border", "│") + " ".repeat(innerW) + th.fg("border", "│"));
		}

		// Bottom border with help hint
		const hint = " ctrl+shift+↑↓ scroll ";
		const hintVis = visibleWidth(hint);
		const hintLeft = Math.max(0, Math.floor((innerW - hintVis) / 2));
		const hintRight = Math.max(0, innerW - hintVis - hintLeft);
		const hintPadded = "─".repeat(hintLeft) + hint + "─".repeat(hintRight);
		result.push(th.fg("border", "╰") + th.fg("dim", hintPadded) + th.fg("border", "╯"));

		return result;
	}

	scrollUp(lines = 1): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - lines);
		this.tui.requestRender();
	}

	scrollDown(lines = 1): void {
		const allLines = this.buildAllLines();
		const maxScroll = Math.max(0, allLines.length - this.maxLines);
		this.scrollOffset = Math.min(maxScroll, this.scrollOffset + lines);
		this.tui.requestRender();
	}

	scrollToTop(): void {
		this.scrollOffset = 0;
		this.tui.requestRender();
	}

	scrollToBottom(): void {
		const allLines = this.buildAllLines();
		const maxScroll = Math.max(0, allLines.length - this.maxLines);
		this.scrollOffset = maxScroll;
		this.tui.requestRender();
	}
}
