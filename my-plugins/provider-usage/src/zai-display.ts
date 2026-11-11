import { formatLocalTime } from "./format-local-time.js";
import { sanitizeDisplayText } from "./sanitize-display-text.js";
import type { ZaiQuota, ZaiQuotaLine } from "./zai-quota.js";

function formatPeriod(line: ZaiQuotaLine): string {
	if (line.period.kind === "unknown") return "unknown period";
	const { unit, amount } = line.period;
	if (unit === 3) return `${amount}h`;
	if (unit === 4) return amount === 1 ? "day" : `${amount}d`;
	if (unit === 5) return amount === 1 ? "month" : `${amount}month`;
	return amount === 1 ? "week" : `${amount}week`;
}

function formatLine(line: ZaiQuotaLine): string {
	const reset = line.resetAt === undefined ? "" : `, resets ${formatLocalTime(line.resetAt)}`;
	if (line.kind === "time") {
		const details = line.details.map((detail) => `${sanitizeDisplayText(detail.modelCode)} ${detail.usage}`).join(", ");
		return `tools ${line.currentValue}/${line.usage}(${formatPeriod(line)})${details ? ` ${details}` : ""}${reset}`;
	}
	return line.kind === "tokens"
		? `${line.percentage}%(${formatPeriod(line)}) used${reset}`
		: `credits ${line.percentage}%(${formatPeriod(line)}) used${reset}`;
}

export function formatZaiCompact(data: ZaiQuota): string {
	const percentageLines = data.lines.filter((line) => line.kind !== "time").slice(0, 2);
	if (percentageLines.length > 0) {
		return percentageLines.map((line) => {
			const period = formatPeriod(line);
			const duplicate = percentageLines.some((other) => other !== line && formatPeriod(other) === period);
			return `${duplicate && line.kind === "credit" ? "credit " : ""}${line.percentage}%(${period})`;
		}).join(", ");
	}
	const first = data.lines[0];
	return first?.kind === "time" ? `tools ${first.currentValue}/${first.usage}(${formatPeriod(first)})` : "";
}

export function formatZaiQuota(data: ZaiQuota): string {
	const parts = data.lines.map(formatLine);
	if (data.partial) parts.push("some fields unparsed");
	return sanitizeDisplayText(parts.join(", "));
}
