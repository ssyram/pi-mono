import { describe, expect, it } from "vitest";
import { aggregatePool, aggregateWindow } from "../src/pool-usage.js";
import type { KeyUsage, PoolSnapshot } from "../src/pool-snapshot.js";
import type { QuotaPolicy } from "../src/plugin-config.js";

function key(id: string, fiveHour?: number, weekly?: number, route: KeyUsage["route"] = "enabled"): KeyUsage {
	return {
		id,
		channelId: 1,
		route,
		tier: "standby",
		fiveHour: fiveHour === undefined ? undefined : { usedPercent: fiveHour },
		weekly: weekly === undefined ? undefined : { usedPercent: weekly },
		query: fiveHour === undefined && weekly === undefined ? "failed" : "ok",
	};
}

function snapshot(keys: KeyUsage[]): PoolSnapshot {
	return {
		info: { instanceId: "i", controlUrl: "http://127.0.0.1:1", relayBaseUrl: "http://127.0.0.1:2/v1" },
		phase: "ready",
		observedAtMs: Date.now(),
		pollIntervalMs: 60_000,
		healthy: true,
		dryRun: false,
		unmanagedChannelIds: [],
		keys,
	};
}

const equal: QuotaPolicy = { kind: "equal" };

describe("aggregateWindow", () => {
	it("equal capacities average percentages", () => {
		const result = aggregateWindow([key("a", 20, 10), key("b", 60, 30)], "fiveHour", equal);
		expect(result.kind).toBe("known");
		if (result.kind === "known") {
			expect(result.usedPercent).toBeCloseTo(40);
			expect(result.capacity).toBe(2);
			expect(result.unit).toBe("account-equivalent");
		}
	});

	it("weighted capacities weight each window separately", () => {
		const policy: QuotaPolicy = {
			kind: "weighted",
			unit: "plan",
			keys: { a: { fiveHour: 3, weekly: 1 }, b: { fiveHour: 1, weekly: 1 } },
		};
		const five = aggregateWindow([key("a", 0, 0), key("b", 100, 100)], "fiveHour", policy);
		const week = aggregateWindow([key("a", 0, 0), key("b", 100, 100)], "weekly", policy);
		if (five.kind === "known" && week.kind === "known") {
			expect(five.usedPercent).toBeCloseTo(25);
			expect(week.usedPercent).toBeCloseTo(50);
		} else {
			throw new Error("expected known aggregates");
		}
	});

	it("unknown when empty, missing window, or missing capacity", () => {
		expect(aggregateWindow([], "fiveHour", equal)).toMatchObject({ kind: "unknown", reason: "missing-window" });
		expect(aggregateWindow([key("a", 20), key("b", undefined, 10)], "fiveHour", equal)).toMatchObject({
			kind: "unknown",
			reason: "missing-window",
			knownKeys: 1,
		});
		expect(
			aggregateWindow([key("a", 20)], "fiveHour", { kind: "weighted", unit: "u", keys: { b: { fiveHour: 1, weekly: 1 } } }),
		).toMatchObject({ kind: "unknown", reason: "missing-capacity" });
	});

	it("100% keys stay in the denominator; order and scaling are invariant", () => {
		const full = aggregateWindow([key("a", 100), key("b", 0)], "fiveHour", equal);
		if (full.kind !== "known") throw new Error("expected known");
		expect(full.usedPercent).toBeCloseTo(50);
		const policy: QuotaPolicy = { kind: "weighted", unit: "u", keys: { a: { fiveHour: 7, weekly: 7 }, b: { fiveHour: 3, weekly: 3 }, c: { fiveHour: 5, weekly: 5 } } };
		for (let seed = 1; seed <= 25; seed++) {
			const keys = [key("a", (seed * 3) % 101, seed % 101), key("b", seed % 101, (seed * 5) % 101), key("c", (seed * 7) % 101, seed % 101)];
			const original = aggregateWindow(keys, "fiveHour", policy);
			const reordered = aggregateWindow([...keys].reverse(), "fiveHour", policy);
			expect(reordered.kind).toBe(original.kind);
			if (original.kind === "known" && reordered.kind === "known") {
				expect(reordered.usedPercent).toBeCloseTo(original.usedPercent, 9);
				expect(reordered.capacity).toBe(original.capacity);
			}
			if (original.kind === "known") {
				const scaled: QuotaPolicy = {
					kind: "weighted",
					unit: "u",
					keys: Object.fromEntries(Object.entries(policy.keys).map(([id, w]) => [id, { fiveHour: w.fiveHour * 2, weekly: w.weekly * 2 }])),
				};
				const scaledResult = aggregateWindow(keys, "fiveHour", scaled);
				if (scaledResult.kind === "known") {
					expect(scaledResult.usedPercent).toBeCloseTo(original.usedPercent, 6);
				}
			}
		}
	});
});

describe("aggregatePool", () => {
	it("keeps windows separate and counts unroutable keys", () => {
		const usage = aggregatePool(snapshot([key("a", 10, 90), { ...key("b", 20, 80), route: "disabled" }]), equal);
		if (usage.fiveHour.kind !== "known" || usage.weekly.kind !== "known") throw new Error("expected known");
		expect(usage.fiveHour.usedPercent).toBeCloseTo(15);
		expect(usage.weekly.usedPercent).toBeCloseTo(85);
		expect(usage.unroutableKeys).toBe(1);
	});
});
