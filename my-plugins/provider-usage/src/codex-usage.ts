import { isJsonRecord } from "./json-record.js";
import { parseCodexWindow, type CodexWindow } from "./codex-window.js";

export interface CodexUsageWindow {
	group: "primary" | "secondary";
	label?: string;
	window: CodexWindow;
}

export type CodexCredit = { kind: "unlimited" } | { kind: "balance"; balance: string };

export interface CodexUsage {
	windows: CodexUsageWindow[];
	credit?: CodexCredit;
	partial: boolean;
}

function parseBalance(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return String(value);
	if (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return value;
	return undefined;
}

function rateContainerFields(value: Record<string, unknown>): { primary: unknown; secondary: unknown; partial: boolean } | undefined {
	if (Object.hasOwn(value, "used_percent")) return { primary: value, secondary: undefined, partial: false };
	const primaryWindow = value.primary_window;
	const primary = value.primary;
	const secondaryWindow = value.secondary_window;
	const secondary = value.secondary;
	if (primaryWindow !== undefined && primary !== undefined) return undefined;
	if (secondaryWindow !== undefined && secondary !== undefined) return undefined;
	if (primaryWindow === undefined && primary === undefined && secondaryWindow === undefined && secondary === undefined) return undefined;
	const known = new Set(["primary_window", "primary", "secondary_window", "secondary"]);
	return {
		primary: primaryWindow ?? primary,
		secondary: secondaryWindow ?? secondary,
		partial: Object.keys(value).some((key) => !known.has(key)),
	};
}

function appendRateContainer(
	value: unknown,
	label: string | undefined,
	windows: CodexUsageWindow[],
): { valid: boolean; partial: boolean } {
	if (value === null || value === undefined) return { valid: true, partial: false };
	if (!isJsonRecord(value)) return { valid: false, partial: false };
	const fields = rateContainerFields(value);
	if (!fields) return { valid: false, partial: false };
	const primary = parseCodexWindow(fields.primary);
	const secondary = parseCodexWindow(fields.secondary);
	if (primary.kind === "invalid" || secondary.kind === "invalid") return { valid: false, partial: false };
	if (primary.kind === "window") windows.push({ group: "primary", ...(label ? { label } : {}), window: primary.window });
	if (secondary.kind === "window") windows.push({ group: "secondary", ...(label ? { label } : {}), window: secondary.window });
	return { valid: true, partial: fields.partial };
}

function parseCredit(value: unknown): { valid: boolean; credit?: CodexCredit } {
	if (value === null || value === undefined) return { valid: true };
	if (!isJsonRecord(value) || typeof value.has_credits !== "boolean") return { valid: false };
	const unlimited = value.unlimited;
	if (unlimited !== undefined && typeof unlimited !== "boolean") return { valid: false };
	const balance = value.balance === undefined ? undefined : parseBalance(value.balance);
	if (value.balance !== undefined && balance === undefined) return { valid: false };
	if (!value.has_credits) {
		if (balance !== undefined && Number(balance) !== 0) return { valid: false };
		return { valid: true };
	}
	if (unlimited === true) return { valid: true, credit: { kind: "unlimited" } };
	if (balance === undefined) return { valid: false };
	return { valid: true, credit: { kind: "balance", balance } };
}

function additionalLabel(value: Record<string, unknown>): string {
	if (typeof value.limit_name === "string" && value.limit_name.trim() !== "") return value.limit_name;
	if (typeof value.metered_feature === "string" && value.metered_feature.trim() !== "") return value.metered_feature;
	return "附加额度";
}

export function parseCodex(value: unknown): CodexUsage | undefined {
	if (!isJsonRecord(value)) return undefined;
	const windows: CodexUsageWindow[] = [];
	let partial = false;
	const primary = appendRateContainer(value.rate_limit, undefined, windows);
	if (!primary.valid) return undefined;
	partial ||= primary.partial;
	const review = appendRateContainer(value.code_review_rate_limit, "代码审查", windows);
	if (!review.valid) return undefined;
	partial ||= review.partial;
	const additional = value.additional_rate_limits;
	if (additional !== null && additional !== undefined) {
		if (!Array.isArray(additional)) return undefined;
		for (const item of additional) {
			if (!isJsonRecord(item)) return undefined;
			const parsed = appendRateContainer(item.rate_limit, additionalLabel(item), windows);
			if (!parsed.valid) return undefined;
			partial ||= parsed.partial || Object.keys(item).some((key) => key !== "limit_name" && key !== "metered_feature" && key !== "rate_limit");
		}
	}
	const credit = parseCredit(value.credits);
	if (!credit.valid) return undefined;
	if (windows.length === 0 && !credit.credit) return undefined;
	return { windows, ...(credit.credit ? { credit: credit.credit } : {}), partial };
}
