import { sanitizeDisplayText } from "./sanitize-display-text.js";
import type { ZaiQuota, ZaiQuotaLine } from "./zai-quota.js";

function formatPeriod(line: ZaiQuotaLine): string {
	if (line.period.kind === "unknown") return "周期未知";
	const { unit, amount } = line.period;
	if (unit === 3) return `${amount}h`;
	if (unit === 4) return amount === 1 ? "day" : `${amount}d`;
	if (unit === 5) return amount === 1 ? "month" : `${amount}month`;
	return amount === 1 ? "week" : `${amount}week`;
}

function formatLine(line: ZaiQuotaLine): string {
	const reset = line.resetAt === undefined ? "" : ` 重置 ${new Date(line.resetAt).toISOString()}`;
	if (line.kind === "time") {
		const details = line.details.map((detail) => `${sanitizeDisplayText(detail.modelCode)} ${detail.usage}`).join(", ");
		return `工具 ${line.currentValue}/${line.usage}(${formatPeriod(line)})${details ? ` ${details}` : ""}${reset}`;
	}
	return line.kind === "tokens"
		? `已用 ${line.percentage}%(${formatPeriod(line)})${reset}`
		: `额度 已用 ${line.percentage}%(${formatPeriod(line)})${reset}`;
}

export function formatZaiCompact(data: ZaiQuota): string {
	const percentageLines = data.lines.filter((line) => line.kind !== "time").slice(0, 2);
	if (percentageLines.length > 0) {
		return percentageLines.map((line) => {
			const period = formatPeriod(line);
			const duplicate = percentageLines.some((other) => other !== line && formatPeriod(other) === period);
			return `${duplicate && line.kind === "credit" ? "额度" : ""}${line.percentage}%(${period})`;
		}).join(", ");
	}
	const first = data.lines[0];
	return first?.kind === "time" ? `工具 ${first.currentValue}/${first.usage}(${formatPeriod(first)})` : "";
}

export function formatZaiQuota(data: ZaiQuota): string {
	const parts = data.lines.map(formatLine);
	if (data.partial) parts.push("部分信息未解析");
	return sanitizeDisplayText(parts.join(", "));
}
