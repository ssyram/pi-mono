import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { snapshotExternalRuns, unregisterExternalRun, type ExternalRun } from "../.build/nico/api/external-runs.js";
import type { FleetChildView, FleetView } from "../src/subagents/hc-fleet-view.ts";
import { SessionStatsReader } from "../src/tui/fleet-stats.ts";
import { buildNicoFleetActions, buildNicoFleetState, refreshNicoFleetRuns, toExternalRun } from "../src/tui/nico-fleet-adapter.ts";

const EMPTY_STATS = { spentTokens: 0, costTotal: 0, windowTokens: null, ctxPercent: null, firstTs: 1_700_000_000_000, lastTs: 1_700_000_060_000 };
const USED_STATS = { spentTokens: 92_100, costTotal: 0.9, windowTokens: 157_500, ctxPercent: 41, firstTs: 1_700_000_000_000, lastTs: 1_700_000_060_000 };

function child(overrides: Partial<FleetChildView> = {}): FleetChildView {
	return { sessionId: "ses_a", parentSessionId: "root", name: "worker-a", model: "p/m", thinking: "off",
		lifecycle: "idle", outcome: null, runActive: false, sessionFile: "/tmp/a.jsonl", cwd: "/w", depth: 1, ...overrides };
}

test("toExternalRun maps FSM actor facts into currentAction and statuses onto vendor states", () => {
	const withActor = toExternalRun(child(), { agentId: "ses_a", fsmName: "CCodeAnalyze-decoupled", stateId: "phase2", noProgress: 0 }, EMPTY_STATS, "root");
	assert.equal(withActor.currentAction, "fsm:CCodeAnalyze-decoupled:phase2");
	assert.equal(withActor.state, "completed");
	assert.equal(withActor.endedAt, EMPTY_STATS.lastTs, "terminal rows record an end");
	assert.equal(withActor.updatedAt, EMPTY_STATS.lastTs);
	assert.equal(withActor.transcriptPath, "/tmp/a.jsonl");
	assert.equal(withActor.sessionId, "root", "rows are scoped to the owning root session");
	assert.equal(withActor.label, "worker-a [CCodeAnalyze-decoupled:phase2]", "the roster label carries the FSM state");
	assert.equal(toExternalRun(child(), { agentId: "ses_a", fsmName: "S", stateId: "W", noProgress: 0 }, USED_STATS, "root").label,
		"worker-a [S:W] · ↓ 157.5k window · 92.1k spent", "the label carries live usage in the native status-bar format");

	const stalled = toExternalRun(child({ sessionId: "ses_b", runActive: true }), { agentId: "ses_b", fsmName: "NativeRoot", stateId: "WORK", noProgress: 3 }, EMPTY_STATS, "root");
	assert.equal(stalled.currentAction, "fsm:NativeRoot:WORK ⏱3");
	assert.equal(stalled.label, "worker-a [NativeRoot:WORK ⏱3]");
	assert.equal(stalled.state, "running");
	assert.equal(stalled.endedAt, undefined, "running rows have no end");

	assert.equal(toExternalRun(child({ lifecycle: "failed" }), undefined, EMPTY_STATS, "root").state, "failed");
	assert.equal(toExternalRun(child({ outcome: "failed" }), undefined, EMPTY_STATS, "root").state, "failed");
	assert.equal(toExternalRun(child({ outcome: "cancelled" }), undefined, EMPTY_STATS, "root").state, "stopped");
	assert.equal(toExternalRun(child({ name: null }), undefined, EMPTY_STATS, "root").label, "ses_a", "missing name falls back to the session id with no FSM suffix");
	assert.equal(toExternalRun(child({ name: "bad\u0007name\n" }), undefined, EMPTY_STATS, "root").label.startsWith("bad"), true, "labels are display-sanitized");
});

test("buildNicoFleetState supplies every state field the vendor fleet TUI reads", async () => {
	const deps = { fleet: () => ({}) as FleetView, actors: async () => [], rootSessionId: "root", baseCwd: "/w", contextWindowOf: () => null, abortChild: async () => {} };
	const state = buildNicoFleetState(deps) as unknown as Record<string, unknown>;
	const supplied = new Set(Object.keys(state));

	const vendorRoot = join(import.meta.dirname, "../vendor/pi-subagents/src/tui");
	const readFields: string[] = [];
	for (const file of ["fleet.ts", "fleet-status.ts"]) {
		const source = await readFile(join(vendorRoot, file), "utf8");
		readFields.push(...[...source.matchAll(/state\.([A-Za-z]+)/g)].map((match) => match[1] ?? ""));
	}
	const unique = [...new Set(readFields)].filter(Boolean);
	/** Optional on SubagentState; the TUI guards these paths when the features are unused. */
	const optionalFields = new Set(["supervisorOwnerSessionId", "statusProjectionSessionId", "completionOwnerId", "artifactDirPreference",
		"authorityPolicy", "missionStoreConfig", "trustedSessionRoots", "trustedSessionFileRoot", "liveAsyncSessionRoots",
		"retainedForegroundNestedRoutes", "retainedNestedLookupRoutes", "lastParentModel", "subagentInProgress", "subagentSpawns",
		"activeAsyncCapacity", "herdrProjectPanes", "fleetJobs", "fleetInspectorOpen", "widgetsSuspended", "foregroundRuns",
		"completedResults", "asyncJobs", "lastUiContext"]);
	const missing = unique.filter((field) => !supplied.has(field) && !optionalFields.has(field));
	assert.deepEqual(missing, [], `vendor fleet TUI reads state fields the adapter does not supply: ${missing.join(", ")}`);
});

test("livePreview renders the transcript tail for any child, running or settled", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "nico-preview-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const rootDir = join(dir, "ses_root", "ses_child");
	const file = join(rootDir, "session.jsonl");
	const { mkdirSync } = await import("node:fs");
	mkdirSync(rootDir, { recursive: true });
	await writeFile(file, [
		JSON.stringify({ type: "message", message: { role: "user", content: "go" } }),
		JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "working on it" }, { type: "toolCall", name: "read" }] } }),
		JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false } }),
	].join("\n") + "\n");
	const deps = { fleet: () => ({ list: () => [child({ sessionFile: file })], subscribe: () => () => {}, send: async () => {} }),
		actors: async () => [], rootSessionId: `pv-${Date.now()}`, baseCwd: "/w", contextWindowOf: () => null, abortChild: async () => {} };
	const published = new Map<string, ExternalRun>();
	t.after(() => { for (const run of published.values()) unregisterExternalRun(run.sessionId, run.id); });
	await refreshNicoFleetRuns(deps, published, new Map());
	const preview = published.get("ses_a")?.preview ?? "";
	assert.match(preview, /go/, "user lines render");
	assert.match(preview, /working on it/, "assistant text renders");
	assert.match(preview, /read/, "tool calls render by name");
	assert.match(preview, /ok/, "tool output renders");
	assert.ok(preview.includes("✓") || preview.includes("●") || preview.includes("·"), "vendor transcript glyphs are used");
});

test("refreshNicoFleetRuns reconciles the in-process external-run registry with the live children", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "nico-fleet-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const fileA = join(dir, "a.jsonl");
	await writeFile(fileA, JSON.stringify({ type: "message", message: { role: "assistant", timestamp: "2026-10-30T00:00:00Z",
		content: [{ type: "text", text: "done" }], usage: { input: 1000, output: 10, totalTokens: 1010, cost: { total: 0.001 } } } }) + "\n");

	const owner = `nico-fleet-test-${Date.now()}`;
	t.after(() => { for (const run of snapshotExternalRuns(owner)) unregisterExternalRun(run.sessionId, run.id); });
	let children = [child({ sessionId: "ses_a", sessionFile: fileA, runActive: true }), child({ sessionId: "ses_b", name: "worker-b", sessionFile: join(dir, "b.jsonl") })];
	const fleet: FleetView = {
		list: () => children,
		subscribe: () => () => {},
		send: async () => {},
	};
	const deps = { fleet: () => fleet,
		actors: async () => [{ agentId: "ses_a", fsmName: "NativeRoot", stateId: "WORK", noProgress: 0 }],
		rootSessionId: owner, baseCwd: "/w", contextWindowOf: () => null, abortChild: async () => {} };
	const published = new Map<string, ExternalRun>();
	await refreshNicoFleetRuns(deps, published, new Map());

	let rows = snapshotExternalRuns(owner);
	assert.equal(rows.length, 2);
	const rowA = rows.find((row) => row.id === "ses_a");
	assert.equal(rowA?.currentAction, "fsm:NativeRoot:WORK");
	assert.equal(rowA?.state, "running");
	assert.equal(rowA?.transcriptPath, fileA);
	assert.equal(rows.find((row) => row.id === "ses_b")?.state, "completed");

	children = [child({ sessionId: "ses_a", sessionFile: fileA })];
	await refreshNicoFleetRuns(deps, published, new Map());
	rows = snapshotExternalRuns(owner);
	assert.equal(rows.length, 1, "vanished children are unregistered");
	assert.equal(rows[0]?.state, "completed", "changed children are updated in place");
});

test("buildNicoFleetActions: steer reports send failures, stop never blocks on abort", async () => {
	const sent: Array<[string, string]> = [];
	const aborted: string[] = [];
	const deps = { fleet: () => ({ list: () => [], subscribe: () => () => {}, send: async (id: string, message: string) => {
			if (id === "ses_x") throw new Error("no such child");
			sent.push([id, message]); } }),
		actors: async () => [], rootSessionId: "root", baseCwd: "/w", contextWindowOf: () => null,
		abortChild: (id: string) => { aborted.push(id); return Promise.reject(new Error("no live handle")); } };
	const actions = buildNicoFleetActions(deps);

	const steered = await actions.steer({ runId: "ses_a", asyncDir: "", message: "go", mode: "queue" as never });
	assert.equal(steered.isError, undefined);
	assert.deepEqual(sent, [["ses_a", "go"]]);

	const failed = await actions.steer({ runId: "ses_x", asyncDir: "", message: "x", mode: "queue" as never });
	assert.equal(failed.isError, true);

	const stopped = await actions.stop({ runId: "ses_a", asyncDir: "" });
	assert.equal(stopped.isError, undefined);
	assert.deepEqual(aborted, ["ses_a"]);
});

test("SessionStatsReader stays usable across refreshes for vanished children", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "nico-fleet-2-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const file = join(dir, "a.jsonl");
	await writeFile(file, JSON.stringify({ type: "message", message: { role: "assistant", timestamp: "2026-10-30T00:00:00Z",
		content: [{ type: "text", text: "x" }], usage: { input: 5, output: 5, totalTokens: 10, cost: { total: 0 } } } }) + "\n");
	const readers = new Map<string, SessionStatsReader>();
	const owner = `nico-fleet-2-${Date.now()}`;
	const deps = (active: boolean) => ({ fleet: () => ({ list: () => [child({ sessionFile: file, runActive: active })], subscribe: () => () => {}, send: async () => {} }),
		actors: async () => [], rootSessionId: owner, baseCwd: "/w", contextWindowOf: () => null, abortChild: async () => {} });
	const published = new Map<string, ExternalRun>();
	t.after(() => { for (const run of published.values()) unregisterExternalRun(run.sessionId, run.id); });
	await refreshNicoFleetRuns(deps(true), published, readers);
	await refreshNicoFleetRuns(deps(false), published, readers);
	assert.equal(published.get("ses_a")?.state, "completed");
});
