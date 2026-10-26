import { protocolSessionId } from "../src/binding/create-root-binding.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import type { PersistedBinding } from "../src/binding/actor-binding.ts";
import { projectOcRoster, projectOcStatuses } from "../src/records/oc-roster.ts";
import { RecordStore } from "../src/records/record-store.ts";
import type { RecordFacts } from "../src/records/session-record.ts";

function binding(sessionId: string, rootSessionId: string, parent: string | null): PersistedBinding {
	return parent === null
		? { version: 1, rootSessionId: protocolSessionId(sessionId), sessionId, parentSessionId: null, agentId: "main",
			kind: "execution-root", agentName: null, bootstrapRef: null, requiredExtensions: [] }
		: { version: 1, rootSessionId, sessionId, parentSessionId: parent, agentId: sessionId,
			kind: "execution-child", agentName: "worker", bootstrapRef: "boot", requiredExtensions: [] };
}

function facts(lifecycle: RecordFacts["lifecycle"], created: string, sessionId: string): RecordFacts {
	const header = { type: "session", version: 3, id: sessionId, timestamp: created, cwd: "/work" } as SessionHeader;
	return { title: "session", lifecycle, updatedAt: Date.parse(created) + 5000, header,
		branch: [] as SessionEntry[], sessionFile: null, errorMessage: null };
}

const ROOT = "2026-10-14T10:00:00.000Z";

test("roster is a real BFS of the execution tree with judges as separate roots", () => {
	const store = new RecordStore(binding("root", "root", null));
	store.publishExecution(binding("root", "root", null), facts("running", ROOT, "root"));
	store.publishExecution(binding("child-b", protocolSessionId("root"), "root"), facts("idle", "2026-10-14T10:01:00.000Z", "child-b"));
	store.publishExecution(binding("child-a", protocolSessionId("root"), "root"), facts("running", "2026-10-14T10:02:00.000Z", "child-a"));
	store.publishExecution(binding("grand", protocolSessionId("root"), "child-a"), facts("settling", "2026-10-14T10:03:00.000Z", "grand"));
	store.publishExecution(binding("orphan", protocolSessionId("root"), "missing-parent"), facts("running", "2026-10-14T10:04:00.000Z", "orphan"));
	store.registerJudge({ sessionId: "judge-1", title: "fsm-gate", createdAt: Date.parse(ROOT) + 10,
		updatedAt: Date.parse(ROOT) + 20, sessionFile: null, lifecycle: "busy" });
	const roster = projectOcRoster(store);
	assert.deepEqual(roster.map((session) => session.id), [protocolSessionId("root"), "child-a", "child-b", "grand", "judge-1"]);
	// HC wire parity: a root session omits parentID entirely; children carry it.
	assert.deepEqual(roster.map((session) => session.parentID), [undefined, protocolSessionId("root"), protocolSessionId("root"), "child-a", null]);
	assert.equal("parentID" in (roster[0] ?? {}), false);
	assert.equal(roster[3]?.parentID, "child-a");
	assert.equal(roster[4]?.parentID, null);
	assert.deepEqual(roster[0]?.time, { created: Date.parse(ROOT), updated: Date.parse(ROOT) + 5000 });
});

test("statuses map real lifecycles and never hide unavailable facts as idle", () => {
	const store = new RecordStore(binding("root", "root", null));
	store.publishExecution(binding("root", "root", null), facts("retrying", ROOT, "root"));
	store.publishExecution(binding("done", protocolSessionId("root"), "root"), facts("aborted", "2026-10-14T10:01:00.000Z", "done"));
	store.registerJudge({ sessionId: "judge-1", title: "fsm-gate", createdAt: 1, updatedAt: 2,
		sessionFile: null, lifecycle: "idle" });
	// OC /session/status lists only active runs: idle executions are absent,
	// idle judges stay listed (judge lifecycle remains observable).
	assert.deepEqual(projectOcStatuses(store), new Map([[protocolSessionId("root"), { type: "retry" }], ["judge-1", { type: "idle" }]]));
	const hidden = new RecordStore(binding("root2", "root2", null));
	hidden.publishExecution(binding("root2", "root2", null), facts("running", ROOT, "root2"));
	hidden.publishExecution(binding("lost", protocolSessionId("root2"), "root2"), facts("unavailable", "2026-10-14T10:01:00.000Z", "lost"));
	assert.throws(() => projectOcStatuses(hidden), { code: "not-ready" });
	const judgeLost = new RecordStore(binding("root3", "root3", null));
	judgeLost.publishExecution(binding("root3", "root3", null), facts("idle", ROOT, "root3"));
	judgeLost.registerJudge({ sessionId: "judge-x", title: "fsm-gate", createdAt: 1, updatedAt: 2,
		sessionFile: null, lifecycle: "unavailable" });
	assert.throws(() => projectOcStatuses(judgeLost), { code: "not-ready" });
});
