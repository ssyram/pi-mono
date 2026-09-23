import { isJsonRecord } from "./json-record.js";

export interface CodexWindow {
	usedPercent: number;
	windowSeconds?: number;
	resetAt?: number;
}

export type CodexWindowParse =
	| { kind: "window"; window: CodexWindow }
	| { kind: "absent" }
	| { kind: "invalid" };

function isValidTimestampSeconds(value: number): boolean {
	return Number.isInteger(value) && value >= 0 && Number.isFinite(new Date(value * 1000).getTime());
}

export function parseCodexWindow(value: unknown): CodexWindowParse {
	if (value === null || value === undefined) return { kind: "absent" };
	if (!isJsonRecord(value)) return { kind: "invalid" };
	const usedPercent = value.used_percent;
	if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
		return { kind: "invalid" };
	}
	const windowSeconds = value.limit_window_seconds;
	if (
		windowSeconds !== undefined &&
		(typeof windowSeconds !== "number" || !Number.isInteger(windowSeconds) || windowSeconds <= 0)
	) {
		return { kind: "invalid" };
	}
	const resetAt = value.reset_at;
	if (resetAt !== undefined && (typeof resetAt !== "number" || !isValidTimestampSeconds(resetAt))) {
		return { kind: "invalid" };
	}
	return {
		kind: "window",
		window: {
			usedPercent,
			...(typeof windowSeconds === "number" ? { windowSeconds } : {}),
			...(typeof resetAt === "number" ? { resetAt } : {}),
		},
	};
}
