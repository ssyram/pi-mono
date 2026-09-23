import { formatDisplayState } from "./footer-display.js";
import { isJsonRecord } from "./json-record.js";
import { sanitizeDisplayText } from "./sanitize-display-text.js";
import type { SessionTotals } from "./footer-usage.js";
import type { ContextUsageSnapshot, DisplayState, UsageModel, UsageModelRegistry } from "./usage-contract.js";

export interface FooterTheme {
	fg(color: "dim" | "error" | "warning", text: string): string;
	bold(text: string): string;
}

export interface FooterStats {
	left: string;
	rightWithoutProvider: string;
	provider: string | undefined;
}

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function hasSubscriptionProvider(registry: Pick<UsageModelRegistry, "getProvider">, providerId: string): boolean {
	const provider = registry.getProvider(providerId);
	if (!isJsonRecord(provider) || !isJsonRecord(provider.auth) || !isJsonRecord(provider.auth.oauth)) return false;
	return provider.auth.oauth.isSubscription === true;
}

function formatContext(
	context: ContextUsageSnapshot | undefined,
	model: UsageModel | undefined,
	theme: FooterTheme,
): string {
	const percent = context?.percent === null ? undefined : (context?.percent ?? 0);
	const window = context?.contextWindow ?? model?.contextWindow ?? 0;
	const display = `${percent === undefined ? "?" : `${percent.toFixed(1)}%`}/${formatTokens(window)}`;
	if (percent !== undefined && percent > 90) return theme.fg("error", display);
	if (percent !== undefined && percent > 70) return theme.fg("warning", display);
	return display;
}

export function formatStats(
	totals: SessionTotals,
	model: UsageModel | undefined,
	registry: Pick<UsageModelRegistry, "getProvider" | "isUsingOAuth">,
	display: DisplayState,
	context: ContextUsageSnapshot | undefined,
	thinkingLevel: string | undefined,
	theme: FooterTheme,
): FooterStats {
	const parts: string[] = [];
	if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheRead) parts.push(`R${formatTokens(totals.cacheRead)}`);
	if (totals.cacheWrite) parts.push(`W${formatTokens(totals.cacheWrite)}`);
	if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && totals.latestCacheHitRate !== undefined) {
		parts.push(`CH${totals.latestCacheHitRate.toFixed(1)}%`);
	}
	const usingSubscription =
		model !== undefined &&
		(model.provider === "kimi-coding" || (registry.isUsingOAuth(model) && hasSubscriptionProvider(registry, model.provider)));
	const usageText = formatDisplayState(display);
	if (totals.cost > 0 || usingSubscription) {
		parts.push(`$${totals.cost.toFixed(3)}${usageText ? ` ${usageText}` : usingSubscription ? " (sub)" : ""}`);
	} else if (usageText) {
		parts.push(usageText);
	}
	parts.push(formatContext(context, model, theme));
	if (process.env.PI_EXPERIMENTAL === "1") parts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
	const modelId = sanitizeDisplayText(model?.id || "no-model");
	const rightWithoutProvider = model?.reasoning
		? thinkingLevel === undefined || thinkingLevel === "off"
			? `${modelId} • thinking off`
			: `${modelId} • ${sanitizeDisplayText(thinkingLevel)}`
		: modelId;
	return { left: parts.join(" "), rightWithoutProvider, provider: model ? sanitizeDisplayText(model.provider) : undefined };
}
