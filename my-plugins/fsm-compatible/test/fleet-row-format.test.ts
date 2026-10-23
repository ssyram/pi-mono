import assert from "node:assert/strict";
import test from "node:test";
import { formatTokens, fnv1a, renderFleetRow, terminalMark, identityStyle } from "../src/tui/fleet-row-format.ts";
import { buildFleetTree, flattenVisible } from "../src/tui/fleet-tree.ts";

test("formatTokens compresses magnitudes", () => {
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(12_300), "12.3K");
	assert.equal(formatTokens(1_234_567), "1.2M");
});

test("terminalMark maps outcomes and running state", () => {
	assert.equal(terminalMark("completed", false), "done");
	assert.equal(terminalMark("failed", false), "failed");
	assert.equal(terminalMark("crashed", false), "crashed");
	assert.equal(terminalMark("aborted", false), "aborted");
	assert.equal(terminalMark(null, true), null);
	assert.equal(terminalMark(null, false), null);
});

test("fnv1a is deterministic and identityStyle is stable per name", () => {
	assert.equal(fnv1a("worker-a"), fnv1a("worker-a"));
	assert.notEqual(fnv1a("worker-a"), fnv1a("worker-b"));
	const calls: string[] = [];
	const theme = { fg: (style: string, text: string) => { calls.push(style); return text; } };
	const paint = identityStyle(theme, "worker-a", ["accent", "dim"] as const);
	paint("x"); paint("y");
	assert.deepEqual(calls, [calls[0]!, calls[0]!]);
});

test("renderFleetRow fits width and right-aligns metrics", () => {
	const tree = buildFleetTree([{ sessionId: "ses_abcdefgh1234", parentSessionId: "root", name: "worker-b" }], "root");
	const row = flattenVisible(tree, new Set())[1]!;
	const line = renderFleetRow({ row, selected: true, ctxText: "11%", elapsedText: "52s", tokensText: "8.1K", mark: null, width: 60, theme: undefined });
	assert.ok(line.includes("worker-b"));
	assert.ok(line.includes("11%"));
	assert.ok(/8\.1K\s*$/.test(line));
	assert.ok(line.length <= 60 + 40, "kept near width budget");

	const tree2 = buildFleetTree([{ sessionId: "ses_x", parentSessionId: "root", name: "w" }], "root");
	const row2 = flattenVisible(tree2, new Set())[1]!;
	const done = renderFleetRow({ row: row2, selected: false, ctxText: "—", elapsedText: "6m01s", tokensText: "45.2K", mark: "done", width: 60, theme: undefined });
	assert.ok(done.includes("✓done"));
	assert.ok(!done.includes("—"));
});
