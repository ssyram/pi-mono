import { isJsonRecord } from "./json-record.js";

export interface SessionTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	latestCacheHitRate: number | undefined;
}

interface EntryUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

function nonNegativeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageFrom(value: unknown): EntryUsage | undefined {
	if (!isJsonRecord(value) || !isJsonRecord(value.cost)) return undefined;
	const input = nonNegativeNumber(value.input);
	const output = nonNegativeNumber(value.output);
	const cacheRead = nonNegativeNumber(value.cacheRead);
	const cacheWrite = nonNegativeNumber(value.cacheWrite);
	const cost = nonNegativeNumber(value.cost.total);
	if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined || cost === undefined) {
		return undefined;
	}
	return { input, output, cacheRead, cacheWrite, cost };
}

function add(totals: SessionTotals, usage: EntryUsage): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost;
}

export function collectSessionTotals(entries: readonly unknown[]): SessionTotals {
	const totals: SessionTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, latestCacheHitRate: undefined };
	for (const entry of entries) {
		if (!isJsonRecord(entry)) continue;
		if (entry.type === "usage") {
			const usage = usageFrom(entry.usage);
			if (usage) add(totals, usage);
			continue;
		}
		if (entry.type === "message" && isJsonRecord(entry.message)) {
			const usage = usageFrom(entry.message.usage);
			if (!usage) continue;
			if (entry.message.role === "assistant") {
				add(totals, usage);
				const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
				totals.latestCacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
			} else if (entry.message.role === "toolResult") {
				add(totals, usage);
			}
			continue;
		}
		if (entry.type === "branch_summary" || entry.type === "compaction") {
			const usage = usageFrom(entry.usage);
			if (usage) add(totals, usage);
		}
	}
	return totals;
}
