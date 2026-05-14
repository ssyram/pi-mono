import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { getKeybindings, truncateToWidth } from "@mariozechner/pi-tui";
import { getCurrentProgress } from "./scan-cache.js";

export function buildScanProgressComponent(theme: Theme, done: () => void): Component {
	const kb = getKeybindings();
	return {
		render(width: number): string[] {
			const progress = getCurrentProgress();
			const repoLabel = progress?.repoName ?? "Preparing repos";
			const entryLabel = progress?.entryName ?? "Resolving entries";
			const repoProgress = progress?.repoCount
				? `${progress.repoIndex}/${progress.repoCount}`
				: "0/0";
			const entryProgress = progress?.entryCount
				? `${progress.entryIndex}/${progress.entryCount}`
				: "0/0";
			return [
				theme.bold(" Scanning Extensions "),
				"",
				truncateToWidth(`  Repo: ${repoLabel}`, width),
				truncateToWidth(`  Repo progress: ${repoProgress}`, width),
				truncateToWidth(`  Entry: ${entryLabel}`, width),
				truncateToWidth(`  Entry progress: ${entryProgress}`, width),
				"",
				theme.fg("dim", "  Waiting for scan to complete..."),
				theme.fg("dim", "  Esc closes this view (scan continues in the background)"),
			];
		},
		handleInput(data: string): void {
			if (kb.matches(data, "tui.select.cancel")) done();
		},
		invalidate(): void {},
	};
}
