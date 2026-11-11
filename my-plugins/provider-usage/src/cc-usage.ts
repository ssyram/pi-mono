/**
 * Claude Code subscription usage, read from the `claude-code.rate-limit`
 * diagnostics that the pi-claude-code provider attaches to assistant messages.
 * No network request and no Claude Code credential access: the numbers are
 * whatever Claude Code last reported in-stream for this session.
 */
import { isJsonRecord, type JsonRecord } from "./json-record.js";
import { formatLocalTime } from "./format-local-time.js";
import type { QueryResult } from "./usage-contract.js";

const RATE_LIMIT_DIAGNOSTIC = "claude-code.rate-limit";

export type ReadSessionEntries = () => readonly unknown[];

interface UsageWindow {
	label: string;
	percent: number;
	resetsAt?: number | undefined;
}

function messageDiagnostics(message: unknown): unknown[] | undefined {
	if (!isJsonRecord(message) || !Array.isArray(message.diagnostics)) return undefined;
	return message.diagnostics;
}

function latestRateLimitDetails(entries: readonly unknown[]): JsonRecord | undefined {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (!isJsonRecord(entry) || entry.type !== "message") continue;
		const message = entry.message;
		if (!isJsonRecord(message) || message.role !== "assistant") continue;
		const diagnostics = messageDiagnostics(message);
		if (!diagnostics) continue;
		for (let j = diagnostics.length - 1; j >= 0; j -= 1) {
			const diagnostic = diagnostics[j];
			if (isJsonRecord(diagnostic) && diagnostic.type === RATE_LIMIT_DIAGNOSTIC && isJsonRecord(diagnostic.details)) {
				return diagnostic.details;
			}
		}
	}
	return undefined;
}

function windowFromFields(fields: JsonRecord): UsageWindow | undefined {
	const percent = fields.used_percentage;
	if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
	const resetsAt = typeof fields.resets_at === "number" ? fields.resets_at : undefined;
	return { label: "", percent, resetsAt };
}

function windowActive(window: UsageWindow, nowMs: number): boolean {
	return window.resetsAt === undefined || window.resetsAt * 1000 > nowMs;
}

/** Parse the rate-limit payload Claude Code reported. Handles the windowed
 * subscriber shape (`five_hour`/`seven_day`/`spend_limit`), a generic
 * `limits` array, and otherwise hides (older CC builds only send status). */
export function parseClaudeCodeRateLimit(details: JsonRecord, nowMs = Date.now()): UsageWindow[] {
	const windows: UsageWindow[] = [];
	const fiveHour = isJsonRecord(details.five_hour) ? windowFromFields(details.five_hour) : undefined;
	if (fiveHour) windows.push({ ...fiveHour, label: "5h" });
	const sevenDay = isJsonRecord(details.seven_day) ? windowFromFields(details.seven_day) : undefined;
	if (sevenDay) windows.push({ ...sevenDay, label: "7d" });
	const spend = isJsonRecord(details.spend_limit) ? windowFromFields(details.spend_limit) : undefined;
	if (spend) windows.push({ ...spend, label: "spend" });
	if (windows.length === 0 && Array.isArray(details.limits)) {
		for (const limit of details.limits) {
			if (!isJsonRecord(limit) || typeof limit.percent !== "number") continue;
			const group = typeof limit.group === "string" ? limit.group : "";
			const label = group === "five_hour" ? "5h" : group === "seven_day" ? "7d" : group || "limit";
			windows.push({
				label,
				percent: limit.percent,
				resetsAt: typeof limit.resets_at === "number" ? limit.resets_at : undefined,
			});
		}
	}
	return windows.filter((window) => windowActive(window, nowMs));
}

function formatReset(resetsAt: number): string {
	return formatLocalTime(resetsAt * 1000);
}

export function formatClaudeCodeCompact(windows: UsageWindow[]): string {
	return windows.map((window) => `${Math.round(window.percent)}%(${window.label})`).join(" ");
}

export function formatClaudeCodeUsage(windows: UsageWindow[]): string {
	return windows
		.map((window) => `${Math.round(window.percent)}%(${window.label}) used${window.resetsAt ? `, resets ${formatReset(window.resetsAt)}` : ""}`)
		.join(", ");
}

export function queryClaudeCodeUsage(readEntries: ReadSessionEntries | undefined): QueryResult {
	if (!readEntries) return { kind: "not-applicable" };
	let entries: readonly unknown[];
	try {
		entries = readEntries();
	} catch {
		return { kind: "not-applicable" };
	}
	const details = latestRateLimitDetails(entries);
	if (!details) return { kind: "not-applicable" };
	const windows = parseClaudeCodeRateLimit(details);
	if (windows.length === 0) return { kind: "not-applicable" };
	return { kind: "available", text: formatClaudeCodeUsage(windows), compact: formatClaudeCodeCompact(windows) };
}
