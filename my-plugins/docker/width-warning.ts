import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";

export class DockerWidthWarningComponent implements Component {
	constructor(
		private theme: Theme,
		private tui: Pick<TUI, "terminal">,
		private minTermWidth: number,
	) {}

	invalidate(): void {
		// No cached state
	}

	render(width: number): string[] {
		const cols = this.tui.terminal.columns;
		const text = this.theme.fg("warning", `⚠ Docker needs >= ${this.minTermWidth} cols (${cols})`);
		return [truncateToWidth(text, Math.max(1, width), "…", true)];
	}
}
