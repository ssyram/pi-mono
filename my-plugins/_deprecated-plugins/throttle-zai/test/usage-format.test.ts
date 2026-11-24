import { describe, expect, it } from "vitest";
import { aggregatePool } from "../src/pool-usage.js";
import { formatPoolUsage } from "../src/usage-format.js";
import type { KeyUsage, PoolSnapshot } from "../src/pool-snapshot.js";

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

describe("formatPoolUsage", () => {
	it("renders a single-line compact with both windows and approximation", () => {
		const usage = aggregatePool(
			snapshot([
				{ id: "acct-a", channelId: 1, route: "enabled", tier: "active", fiveHour: { usedPercent: 20 }, weekly: { usedPercent: 40, resetAtMs: 0 }, query: "ok" },
			]),
			{ kind: "equal" },
		);
		const { compact, text } = formatPoolUsage(usage);
		expect(compact).toBe("5h ≈20%, week ≈40%");
		expect(text.split("\n")[0]).toContain("≈20% used ≈0.2/1 account-equivalent");
		expect(text).toContain("acct-a 5h 20% · week 40% reset 1970-01-01T00:00:00.000Z");
	});

	it("marks unknown coverage and unrouted keys without fake numbers", () => {
		const usage = aggregatePool(
			snapshot([
				{ id: "acct-a", channelId: 1, route: "enabled", tier: "active", fiveHour: { usedPercent: 20 }, weekly: { usedPercent: 40 }, query: "ok" },
				{ id: "acct-b", channelId: 2, route: "disabled", tier: "unknown", query: "failed" },
			]),
			{ kind: "equal" },
		);
		const { compact, text } = formatPoolUsage(usage);
		expect(compact).toContain("?(1/2 known)");
		expect(compact).toContain("1 unrouted");
		expect(text).toContain("acct-b 5h ? · week ? (unrouted) (query failed)");
	});

	it("strips control characters from labels", () => {
		const usage = aggregatePool(
			snapshot([
				{ id: "acct\na\u0007", channelId: 1, route: "enabled", tier: "active", fiveHour: { usedPercent: 1 }, weekly: { usedPercent: 1 }, query: "ok" },
			]),
			{ kind: "equal" },
		);
		expect(formatPoolUsage(usage).text).toContain("accta");
	});
});
