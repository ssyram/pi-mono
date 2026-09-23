import { isJsonRecord } from "./json-record.js";

export type ZaiRegion = "international" | "china";

type ZaiPeriod = { kind: "known"; unit: 3 | 4 | 5 | 6; amount: number } | { kind: "unknown" };

interface ZaiQuotaBase {
	period: ZaiPeriod;
	resetAt?: number;
}

export interface ZaiPercentQuota extends ZaiQuotaBase {
	kind: "tokens" | "credit";
	percentage: number;
}

export interface ZaiTimeQuota extends ZaiQuotaBase {
	kind: "time";
	currentValue: number;
	usage: number;
	details: Array<{ modelCode: string; usage: number }>;
}

export type ZaiQuotaLine = ZaiPercentQuota | ZaiTimeQuota;

export interface ZaiQuota {
	lines: ZaiQuotaLine[];
	partial: boolean;
}

export type ZaiQuotaParse = { kind: "quota"; quota: ZaiQuota } | { kind: "invalid" };

function parsePeriod(value: Record<string, unknown>): ZaiPeriod | undefined {
	const unit = value.unit;
	if (unit !== 3 && unit !== 4 && unit !== 5 && unit !== 6) return { kind: "unknown" };
	const amount = value.number;
	if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return undefined;
	return { kind: "known", unit, amount };
}

function parseResetAt(value: Record<string, unknown>): number | undefined | null {
	if (value.nextResetTime === undefined) return undefined;
	if (
		typeof value.nextResetTime !== "number" ||
		!Number.isFinite(value.nextResetTime) ||
		!Number.isInteger(value.nextResetTime) ||
		value.nextResetTime < 0 ||
		!Number.isFinite(new Date(value.nextResetTime).getTime())
	) {
		return null;
	}
	return value.nextResetTime;
}

function parseBase(value: Record<string, unknown>): ZaiQuotaBase | undefined {
	const period = parsePeriod(value);
	if (!period) return undefined;
	const resetAt = parseResetAt(value);
	if (resetAt === null) return undefined;
	return { period, ...(resetAt === undefined ? {} : { resetAt }) };
}

function parsePercent(value: Record<string, unknown>, kind: ZaiPercentQuota["kind"]): ZaiPercentQuota | undefined {
	const base = parseBase(value);
	const percentage = value.percentage;
	if (!base || typeof percentage !== "number" || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
		return undefined;
	}
	return { kind, percentage, ...base };
}

function parseTime(value: Record<string, unknown>): ZaiTimeQuota | undefined {
	const base = parseBase(value);
	const currentValue = value.currentValue;
	const usage = value.usage;
	if (
		!base ||
		typeof currentValue !== "number" ||
		!Number.isFinite(currentValue) ||
		currentValue < 0 ||
		typeof usage !== "number" ||
		!Number.isFinite(usage) ||
		usage < 0
	) {
		return undefined;
	}
	const details: Array<{ modelCode: string; usage: number }> = [];
	if (value.usageDetails !== undefined) {
		if (!Array.isArray(value.usageDetails)) return undefined;
		for (const detail of value.usageDetails) {
			if (!isJsonRecord(detail) || typeof detail.modelCode !== "string" || detail.modelCode.trim() === "") return undefined;
			if (typeof detail.usage !== "number" || !Number.isFinite(detail.usage) || detail.usage < 0) return undefined;
			details.push({ modelCode: detail.modelCode, usage: detail.usage });
		}
	}
	return { kind: "time", currentValue, usage, details, ...base };
}

function limitsFrom(root: Record<string, unknown>): unknown {
	if (root.data !== undefined && root.data !== null) {
		if (!isJsonRecord(root.data)) return undefined;
		if (root.data.limits !== undefined) return root.data.limits;
	}
	return root.limits;
}

function typeFrom(line: Record<string, unknown>): string | undefined {
	if (line.type !== undefined) return typeof line.type === "string" ? line.type : undefined;
	return typeof line.name === "string" ? line.name : undefined;
}

export function parseZaiQuota(value: unknown, _region: ZaiRegion): ZaiQuotaParse {
	if (!isJsonRecord(value)) return { kind: "invalid" };
	if (value.success !== undefined && value.success !== true) return { kind: "invalid" };
	if (value.code !== undefined && value.code !== 200) return { kind: "invalid" };
	const limits = limitsFrom(value);
	if (!Array.isArray(limits) || limits.length === 0) return { kind: "invalid" };
	const lines: ZaiQuotaLine[] = [];
	let partial = false;
	for (const item of limits) {
		if (!isJsonRecord(item)) return { kind: "invalid" };
		const type = typeFrom(item);
		if (type === "TOKENS_LIMIT") {
			const quota = parsePercent(item, "tokens");
			if (!quota) return { kind: "invalid" };
			lines.push(quota);
		} else if (type === "CREDIT_LIMIT") {
			const quota = parsePercent(item, "credit");
			if (!quota) return { kind: "invalid" };
			lines.push(quota);
		} else if (type === "TIME_LIMIT") {
			const quota = parseTime(item);
			if (!quota) return { kind: "invalid" };
			lines.push(quota);
		} else {
			partial = true;
		}
	}
	return lines.length === 0 ? { kind: "invalid" } : { kind: "quota", quota: { lines, partial } };
}
