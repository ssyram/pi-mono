/** Pool quota aggregation per declared capacity policy. Percentages only; no absolute claims. */
import type { QuotaPolicy } from "./plugin-config.js";
import type { KeyUsage, PoolSnapshot } from "./pool-snapshot.js";

export type WindowAggregate =
	| {
			kind: "known";
			usedPercent: number;
			used: number;
			capacity: number;
			unit: string;
			keys: number;
	  }
	| { kind: "unknown"; reason: "missing-window" | "missing-capacity"; knownKeys: number; keys: number };

export interface PoolUsage {
	fiveHour: WindowAggregate;
	weekly: WindowAggregate;
	keys: readonly KeyUsage[];
	unroutableKeys: number;
}

type WindowName = "fiveHour" | "weekly";

function capacityFor(policy: QuotaPolicy, keyId: string, window: WindowName): number | undefined {
	if (policy.kind === "equal") return 1;
	const entry = policy.keys[keyId];
	return entry?.[window];
}

export function aggregateWindow(keys: readonly KeyUsage[], window: WindowName, policy: QuotaPolicy): WindowAggregate {
	if (keys.length === 0) return { kind: "unknown", reason: "missing-window", knownKeys: 0, keys: 0 };
	let usedWeighted = 0;
	let capacity = 0;
	let known = 0;
	let unit = "account-equivalent";
	for (const key of keys) {
		const entry = key[window];
		const pct = entry?.usedPercent;
		if (pct === undefined || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
		const capacityWeight = capacityFor(policy, key.id, window);
		if (capacityWeight === undefined) {
			return { kind: "unknown", reason: "missing-capacity", knownKeys: known + 1, keys: keys.length };
		}
		known++;
		usedWeighted += (capacityWeight * pct) / 100;
		capacity += capacityWeight;
	}
	if (policy.kind === "weighted") unit = policy.unit;
	if (known < keys.length) return { kind: "unknown", reason: "missing-window", knownKeys: known, keys: keys.length };
	const usedPercent = (usedWeighted / capacity) * 100;
	return { kind: "known", usedPercent, used: usedWeighted, capacity, unit, keys: keys.length };
}

export function aggregatePool(snapshot: PoolSnapshot, policy: QuotaPolicy): PoolUsage {
	return {
		fiveHour: aggregateWindow(snapshot.keys, "fiveHour", policy),
		weekly: aggregateWindow(snapshot.keys, "weekly", policy),
		keys: snapshot.keys,
		unroutableKeys: snapshot.keys.filter((key) => key.route === "disabled").length,
	};
}
