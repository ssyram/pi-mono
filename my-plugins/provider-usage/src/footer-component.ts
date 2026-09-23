import type { Component } from "@earendil-works/pi-tui";
import { formatFooterPath } from "./footer-path.js";
import { layoutFooter } from "./footer-layout.js";
import { formatStats, type FooterTheme } from "./footer-stats.js";
import { collectSessionTotals } from "./footer-usage.js";
import type { ContextUsageSnapshot, DisplayState, UsageModel, UsageModelRegistry } from "./usage-contract.js";

export interface FooterSnapshot {
	model: UsageModel | undefined;
	thinkingLevel: string | undefined;
	display: DisplayState;
}

export interface FooterSource {
	sessionManager: {
		getEntries(): readonly unknown[];
		getCwd(): string;
		getSessionName(): string | undefined;
	};
	modelRegistry: Pick<UsageModelRegistry, "getProvider" | "isUsingOAuth">;
	getContextUsage(): ContextUsageSnapshot | undefined;
	getFooterSnapshot(): FooterSnapshot;
}

export interface FooterTui {
	requestRender(): void;
}

export interface FooterData {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
	onBranchChange(callback: () => void): () => void;
}

export interface UsageFooter extends Component {
	dispose(): void;
}

export type FooterFactory = (tui: FooterTui, theme: FooterTheme, footerData: FooterData) => UsageFooter;

export function createUsageFooter(tui: FooterTui, theme: FooterTheme, footerData: FooterData, source: FooterSource): UsageFooter {
	let disposed = false;
	const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
	return {
		invalidate(): void {
			tui.requestRender();
		},
		render(width: number): string[] {
			if (disposed) return [];
			const snapshot = source.getFooterSnapshot();
			const totals = collectSessionTotals(source.sessionManager.getEntries());
			const stats = formatStats(
				totals,
				snapshot.model,
				source.modelRegistry,
				snapshot.display,
				source.getContextUsage(),
				snapshot.thinkingLevel,
				theme,
			);
			const path = formatFooterPath(
				source.sessionManager.getCwd(),
				process.env.HOME || process.env.USERPROFILE,
				footerData.getGitBranch(),
				source.sessionManager.getSessionName(),
			);
			return layoutFooter(path, stats, footerData.getExtensionStatuses(), footerData.getAvailableProviderCount(), width, theme);
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			unsubscribe();
		},
	};
}
