/** compact/text rendering for E2. compact single line; text pool summary + per-key lines. */
import type { PoolUsage, WindowAggregate } from "./pool-usage.js";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function clean(value: string): string {
	return value.replace(CONTROL_CHARS, "").slice(0, 48);
}

function formatPercent(percent: number): string {
	return `${Math.round(percent * 10) / 10}%`;
}

function formatReset(resetAtMs: number | undefined): string {
	if (resetAtMs === undefined) return "";
	return ` reset ${new Date(resetAtMs).toISOString()}`;
}

function formatAggregate(aggregate: WindowAggregate): string {
	if (aggregate.kind === "unknown") return `?(${aggregate.knownKeys}/${aggregate.keys} known)`;
	return `≈${formatPercent(aggregate.usedPercent)}`;
}

export function formatPoolUsage(usage: PoolUsage): { compact: string; text: string } {
	const parts = [`5h ${formatAggregate(usage.fiveHour)}`, `week ${formatAggregate(usage.weekly)}`];
	if (usage.unroutableKeys > 0) parts.push(`${usage.unroutableKeys} unrouted`);
	const compact = parts.join(", ");
	const lines: string[] = [];
	const describe = (name: string, aggregate: WindowAggregate): string => {
		if (aggregate.kind === "unknown") {
			return `${name}: unknown (${aggregate.knownKeys}/${aggregate.keys} keys report data)`;
		}
		return `${name}: ≈${formatPercent(aggregate.usedPercent)} used ≈${Math.round(aggregate.used * 100) / 100}/${aggregate.capacity} ${aggregate.unit}`;
	};
	lines.push(describe("5h", usage.fiveHour));
	lines.push(describe("week", usage.weekly));
	if (usage.unroutableKeys > 0) lines.push(`unroutable keys: ${usage.unroutableKeys}`);
	for (const key of usage.keys) {
		const five = key.fiveHour ? `${formatPercent(key.fiveHour.usedPercent)}${formatReset(key.fiveHour.resetAtMs)}` : "?";
		const week = key.weekly ? `${formatPercent(key.weekly.usedPercent)}${formatReset(key.weekly.resetAtMs)}` : "?";
		const route = key.route === "disabled" ? " (unrouted)" : "";
		const failed = key.query === "failed" ? " (query failed)" : "";
		lines.push(`${clean(key.id)} 5h ${five} · week ${week}${route}${failed}`);
	}
	return { compact, text: lines.join("\n") };
}
