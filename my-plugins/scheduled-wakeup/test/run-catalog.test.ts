import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
	CANCELLED_FILE,
	DELIVERED_FILE,
	LIVE_SOCK,
	RESULT_FILE,
	STATUS_FILE,
	TASK_FILE,
	readJson,
	writeJsonAtomic,
} from "../src/script-tasks/run-record.js";
import {
	KEEP_AGE_MS,
	KEEP_PER_TASK,
	START_GRACE_MS,
	failedOutcome,
	scanRuns,
} from "../src/v2/run-catalog-state.js";
import {
	parseTaskRecord,
	parseStatus,
	parseOutcome,
	type RunStatus,
} from "../src/script-tasks/run-record.js";

const NOW = 1_000_000_000_000;

function makeRoot(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "loop-catalog-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function makeRun(
	root: string,
	taskId: string,
	runId: string,
	owner = "owner-session",
	startedAt = NOW,
) {
	const dir = join(root, taskId, runId);
	mkdirSync(dir, { recursive: true });
	writeJsonAtomic(join(dir, TASK_FILE), {
		version: 1,
		taskId,
		scope: "session",
		payload: {
			scriptTask: {
				wakeUp: { kind: "always", prompt: "p" },
				scripts: [{ cwd: "/w", path: "/w/one", params: [], timeoutSeconds: 1 }],
			},
		},
		ownerSessionId: owner,
		startedAt,
	});
	return dir;
}

function writeStatus(dir: string, pid: number) {
	writeJsonAtomic(join(dir, STATUS_FILE), {
		pid,
		currentIndex: 0,
		success: 0,
		completed: 0,
		total: 1,
		updatedAt: NOW,
	});
}

async function withListener(path: string, work: () => Promise<void>) {
	const server: Server = createServer(() => undefined);
	await new Promise<void>((resolve) => server.listen(path, resolve));
	try {
		await work();
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

async function states(
	root: string,
	sessionId = "owner-session",
	now = () => NOW,
) {
	const result = await scanRuns(root, { synthesize: true, sessionId, now });
	return result.views.map((view) => ({ id: view.runId, state: view.state }));
}

test("a live socket keeps the run classified as running", async (t) => {
	const root = makeRoot(t);
	const dir = makeRun(root, "session:a", "r1");
	writeStatus(dir, 4321);
	await withListener(join(dir, LIVE_SOCK), async () => {
		assert.deepEqual(await states(root), [{ id: "r1", state: "running" }]);
	});
});

test("a dead wrapper is synthesized into a failed pendingDelivery run by its owner", async (t) => {
	const root = makeRoot(t);
	const dir = makeRun(root, "session:a", "r1");
	writeStatus(dir, 4321);
	assert.deepEqual(await states(root), [
		{ id: "r1", state: "pendingDelivery" },
	]);
	const outcome = readJson(join(dir, RESULT_FILE)) as {
		results: { status: string; error: string }[];
		shouldWake: boolean;
	};
	assert.equal(outcome.results[0]?.status, "failed");
	assert.match(outcome.results[0]?.error ?? "", /runner lost/);
	assert.equal(outcome.shouldWake, true);
});

test("fork sessions (different id) get zero visibility and zero synthesis", async (t) => {
	const root = makeRoot(t);
	const dir = makeRun(root, "session:a", "r1", "owner-session");
	writeStatus(dir, 4321);
	writeJsonAtomic(join(dir, RESULT_FILE), {
		cancelled: false,
		results: [],
		successCount: 0,
		shouldWake: false,
		completedAt: NOW,
		content: "c",
	});
	const result = await scanRuns(root, {
		synthesize: true,
		sessionId: "fork-session",
		now: () => NOW,
	});
	assert.deepEqual(result.views, []);
	assert.deepEqual(result.foreignTaskIds, ["session:a"]);
	// Zero disk contact: no marker, no synthesis into the foreign run.
	assert.equal(existsSync(join(dir, CANCELLED_FILE)), false);
	assert.doesNotMatch(
		String(readJson(join(dir, RESULT_FILE))),
		/runner lost/,
	);
	// Owner still sees its run exactly as it was.
	assert.deepEqual(await states(root), [
		{ id: "r1", state: "pendingDelivery" },
	]);
});


test("stale starts stay running inside the grace window and synthesize after it", async (t) => {
	const root = makeRoot(t);
	const dir = makeRun(root, "session:a", "r1", "owner-session", NOW);
	assert.deepEqual(await states(root), [{ id: "r1", state: "running" }]);
	assert.deepEqual(
		await states(root, "owner-session", () => NOW + START_GRACE_MS + 1),
		[{ id: "r1", state: "pendingDelivery" }],
	);
	const outcome = readJson(join(dir, RESULT_FILE)) as {
		results: { error: string }[];
	};
	assert.match(outcome.results[0]?.error ?? "", /never started/);
});

test("terminal markers win over outcome files", async (t) => {
	const root = makeRoot(t);
	const cancelled = makeRun(root, "session:a", "r1");
	writeJsonAtomic(join(cancelled, RESULT_FILE), {
		cancelled: false,
		results: [],
		successCount: 0,
		shouldWake: true,
		completedAt: NOW,
		content: "c",
	});
	writeJsonAtomic(join(cancelled, CANCELLED_FILE), {
		sessionId: "s",
		at: NOW,
		stage: "pendingDelivery",
	});
	const done = makeRun(root, "session:a", "r2");
	writeJsonAtomic(join(done, RESULT_FILE), {
		cancelled: false,
		results: [],
		successCount: 0,
		shouldWake: true,
		completedAt: NOW,
		content: "c",
	});
	writeJsonAtomic(join(done, DELIVERED_FILE), {
		sessionId: "s",
		deliveredAt: NOW,
		how: "idle-send",
	});
	assert.deepEqual(await states(root), [
		{ id: "r1", state: "cancelled" },
		{ id: "r2", state: "done" },
	]);
});

test("cancelled outcomes are terminal even without a marker", async (t) => {
	const root = makeRoot(t);
	const dir = makeRun(root, "session:a", "r1");
	writeJsonAtomic(join(dir, RESULT_FILE), {
		cancelled: true,
		results: [],
		successCount: 0,
		shouldWake: false,
		completedAt: NOW,
		content: "c",
	});
	assert.deepEqual(await states(root), [{ id: "r1", state: "cancelled" }]);
});

test("gc keeps the newest five terminals and deletes only older ones", async (t) => {
	const root = makeRoot(t);
	const old = NOW - KEEP_AGE_MS - 1000;
	for (let i = 0; i < 7; i += 1) {
		const dir = makeRun(root, "session:a", `r${i}`, "owner-session", old + i);
		writeJsonAtomic(join(dir, RESULT_FILE), {
			cancelled: true,
			results: [],
			successCount: 0,
			shouldWake: false,
			completedAt: old + i,
			content: "c",
		});
	}
	await states(root);
	assert.equal(existsSync(join(root, "session:a", "r0")), false);
	assert.equal(existsSync(join(root, "session:a", "r1")), false);
	for (let i = 2; i < 7; i += 1)
		assert.equal(existsSync(join(root, "session:a", `r${i}`)), true);
	assert.equal(KEEP_PER_TASK, 5);
});

test("E9: a result written between read and probe wins over runner-lost synthesis", async (t) => {
	const root = makeRoot(t);
	const dir = makeRun(root, "session:late", "r1");
	writeStatus(dir, 4321);
	await withListener(join(dir, LIVE_SOCK), async () => {
		assert.deepEqual((await states(root)).map((v) => v.state), ["running"]);
	});
	writeJsonAtomic(join(dir, RESULT_FILE), {
		cancelled: false,
		results: [],
		successCount: 2,
		shouldWake: false,
		completedAt: NOW,
		content: "real outcome",
	});
	const views = (await scanRuns(root, { synthesize: true, sessionId: "owner-session", now: () => NOW })).views;
	assert.equal(views[0]?.state, "pendingDelivery");
	assert.equal(views[0]?.outcome?.content, "real outcome");
	assert.equal(views[0]?.outcome?.successCount, 2);
});

test("E11/E33: failedOutcome honors start-failed kind and the includeTimestamp switch", async (t) => {
	const root = makeRoot(t);
	const dir = makeRun(root, "session:plat", "r1");
	const record = parseTaskRecord(readJson(join(dir, TASK_FILE)));
	assert.ok(record);
	const lost = failedOutcome(record, writeStatusOf(dir), "runner lost", NOW);
	assert.equal(lost.results[0]?.status, "failed");
	assert.doesNotMatch(lost.content, /completed-at:/);
	const stamped = { ...record, payload: { ...record.payload, includeTimestamp: true } };
	const lostStamped = failedOutcome(stamped, undefined, "runner never started", NOW, "start-failed");
	assert.match(lostStamped.content, /completed-at:/);
	assert.equal(lostStamped.results[0]?.status, "start-failed");
});

function writeStatusOf(dir: string): RunStatus | undefined {
	return parseStatus(readJson(join(dir, STATUS_FILE)));
}

test("E14/E4: codec keeps fractional timeouts and rejects malformed results", async (t) => {
	const root = makeRoot(t);
	const dir = makeRun(root, "session:frac", "r1");
	const record = parseTaskRecord(readJson(join(dir, TASK_FILE)));
	assert.ok(record);
	assert.equal(record.payload.scriptTask?.scripts[0]?.timeoutSeconds, 1);
	const fractional = JSON.parse(
		JSON.stringify(readJson(join(dir, TASK_FILE))),
	);
	fractional.payload.scriptTask.scripts[0].timeoutSeconds = 0.5;
	writeJsonAtomic(join(dir, TASK_FILE), fractional);
	const parsed = parseTaskRecord(readJson(join(dir, TASK_FILE)));
	assert.equal(parsed?.payload.scriptTask?.scripts[0]?.timeoutSeconds, 0.5);
	assert.equal(
		parseOutcome({ cancelled: false, results: [{ script: { cwd: "/w" } }], successCount: 0, shouldWake: false, completedAt: 1, content: "x" }),
		undefined,
	);
});

test("bystander sessions never synthesize or GC foreign runs", async (t) => {
	const root = makeRoot(t);
	const dead = makeRun(root, "session:dead", "r1");
	writeStatus(dead, 4321);
	const result = await scanRuns(root, {
		synthesize: true,
		sessionId: "fork-session",
		now: () => NOW,
	});
	assert.deepEqual(
		(await scanRuns(root, {
			synthesize: false,
			sessionId: "owner-session",
			now: () => NOW,
		})).views.map((v) => v.state),
		["lost"],
	);
	assert.equal(existsSync(join(dead, RESULT_FILE)), false);
	const old = NOW - KEEP_AGE_MS - 5000;
	for (let i = 0; i < 7; i += 1) {
		const dir = makeRun(root, "session:gone", `g${i}`, "owner-session", old + i);
		writeJsonAtomic(join(dir, RESULT_FILE), {
			cancelled: true,
			results: [],
			successCount: 0,
			shouldWake: false,
			completedAt: old + i,
			content: "c",
		});
	}
	await scanRuns(root, { synthesize: true, sessionId: "fork-session", now: () => NOW });
	for (let i = 0; i < 7; i += 1)
		assert.equal(existsSync(join(root, "session:gone", `g${i}`)), true);
});
