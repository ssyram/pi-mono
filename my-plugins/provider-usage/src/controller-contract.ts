import type { FooterFactory } from "./footer-component.js";
import type { ContextUsageSnapshot, QueryResult, Route, Selection, UsageModelRegistry } from "./usage-contract.js";

export interface UsageTimer {
	clear(): void;
}

export interface UsageScheduler {
	now(): number;
	after(delayMs: number, callback: () => void): UsageTimer;
}

export type UsageQueryRunner = (
	selection: Selection,
	route: Route,
	registry: Pick<UsageModelRegistry, "getApiKeyAndHeaders">,
	signal: AbortSignal,
) => Promise<QueryResult>;

export interface ControllerContext {
	sessionManager: {
		getSessionId(): string;
		getEntries(): readonly unknown[];
		getCwd(): string;
		getSessionName(): string | undefined;
	};
	modelRegistry: UsageModelRegistry;
	getContextUsage(): ContextUsageSnapshot | undefined;
	setFooter(factory: FooterFactory): void;
	scheduler?: UsageScheduler;
	query?: UsageQueryRunner;
}

export interface PendingJob {
	selection: Selection;
	route: Route;
	generation: number;
}

export interface ActiveJob extends PendingJob {
	abort: AbortController;
	deadline: UsageTimer;
	timedOut: boolean;
	result: QueryResult | undefined;
}

export function systemScheduler(): UsageScheduler {
	return {
		now: () => Date.now(),
		after(delayMs, callback): UsageTimer {
			const timer = setTimeout(callback, delayMs);
			timer.unref();
			return { clear: () => clearTimeout(timer) };
		},
	};
}
