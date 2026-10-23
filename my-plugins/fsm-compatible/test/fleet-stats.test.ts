import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionStatsReader, elapsedTextMs } from "../src/tui/fleet-stats.ts";

function assistantLine(text: string, usage: Record<string, unknown>): string {
	return JSON.stringify({ type: "message", message: { role: "assistant", timestamp: "2026-10-22T00:00:00Z", content: [{ type: "text", text }], usage } });
}

test("SessionStatsReader accumulates incrementally, skips corrupt lines and survives compaction", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "fleet-stats-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const file = join(dir, "session.jsonl");
	await writeFile(file, [
		JSON.stringify({ type: "session", version: 3, id: "s", cwd: dir, timestamp: "2026-10-22T00:00:00Z" }),
		assistantLine("first", { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1100, cost: { total: 0.01 } }),
		"{corrupt json",
		JSON.stringify({ type: "message", message: { role: "user", timestamp: "2026-10-22T00:00:01Z", content: "hi" } }),
	].join("\n") + "\n");
	const reader = new SessionStatsReader(100_000);
	const first = await reader.advance(file);
	assert.equal(first.totalTokens, 0.01);
	assert.equal(first.ctxPercent, 1);
	assert.notEqual(first.firstTs, null);
	await writeFile(file, assistantLine("second", { input: 60_000, output: 50, cacheRead: 30_000, cacheWrite: 0, totalTokens: 90_050, cost: { total: 0.9 } }) + "\n", { flag: "a" });
	const second = await reader.advance(file);
	assert.ok(Math.abs(second.totalTokens - 0.91) < 1e-9);
	assert.equal(second.ctxPercent, 90);
	await writeFile(file, [
		JSON.stringify({ type: "compaction", summary: "compact" }),
		assistantLine("third", { input: 500, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 510, cost: { total: 0.005 } }),
	].join("\n") + "\n", { flag: "a" });
	const third = await reader.advance(file);
	assert.ok(Math.abs(third.totalTokens - 0.915) < 1e-9);
	assert.equal(third.ctxPercent, 1);
	assert.equal(reader.error, null);
});

test("ctxPercent stays within bounds and null without a window", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "fleet-stats-b-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const file = join(dir, "session.jsonl");
	await writeFile(file, assistantLine("big", { input: 900_000, output: 100_000, totalTokens: 1_000_000, cost: { total: 1 } }) + "\n");
	const bounded = await new SessionStatsReader(500_000).advance(file);
	assert.equal(bounded.ctxPercent, 100);
	const noWindow = await new SessionStatsReader(null).advance(file);
	assert.equal(noWindow.ctxPercent, null);
});

test("missing file yields empty stats without advancing", async () => {
	const reader = new SessionStatsReader(1000);
	const stats = await reader.advance("/nonexistent/fleet-session.jsonl");
	assert.equal(stats.totalTokens, 0);
	assert.equal(stats.firstTs, null);
	assert.equal(reader.error, "unreadable");
});

test("elapsedTextMs formats running and terminal spans", () => {
	const base = Date.UTC(2026, 9, 22, 0, 0, 0);
	const stats = { totalTokens: 0, ctxPercent: null, firstTs: base, lastTs: base + 65_000 };
	assert.equal(elapsedTextMs(stats, base + 65_000, true), "1m05s");
	assert.equal(elapsedTextMs(stats, base + 4_000, false), "4s");
	assert.equal(elapsedTextMs({ totalTokens: 0, ctxPercent: null, firstTs: null, lastTs: null }, base, false), "—");
});
