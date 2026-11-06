// Eternal run-watch worker. Plain JS on purpose: it must load through Node's
// worker_threads without any TS transpilation step. Keep the file-literal
// constants below in sync with src/script-tasks/run-record.ts and
// live-socket.ts — this file cannot import them.
//
// Protocol (main -> worker): the shared watch manifest in workerData —
// [version int32][length int32][UTF-8 JSON entries]. The worker scans it
// every tick and diffs; nobody sends messages to the worker, so a dying or
// respawned worker can never lose work: the box outlives every recipient.
// Protocol (worker -> main):
//   { type: "state", run: { dir, taskId, runId, startedAt, state, status, outcome } }
//     -- posted only when something changed since the last post for that dir
//   { type: "finish", dir, taskId, runId, how: "delivered" | "cancelled" }
//   { type: "error", err:
//       { kind: "not-my", taskId, dir, detail }      -- dir re-created by another owner
//       { kind: "vanished", taskId, runId, dir }     -- dir gone, no successor
//       { kind: "unreadable", taskId, runId, dir, detail } }
//
// States per watched dir follow the loop-2 lifecycle: running (live socket or
// start grace) -> pendingDelivery (result.json) -> done (delivered.json) or
// cancelled. Terminal states remove the dir from the watch list. "lost"
// (socket dead, no result) is reported as a state; the main thread repairs it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { parentPort, workerData } from "node:worker_threads";

const MANIFEST_OFFSET = 8;
const manifestShared = workerData?.manifest;
const manifestHeader = manifestShared
	? new Int32Array(manifestShared, 0, 2)
	: undefined;
const manifestBytes = manifestShared
	? new Uint8Array(manifestShared, MANIFEST_OFFSET)
	: undefined;
let manifestVersion = -1;

function readManifest() {
	if (manifestHeader === undefined) return [];
	for (;;) {
		const before = Atomics.load(manifestHeader, 0);
		const length = Atomics.load(manifestHeader, 1);
		if (length === 0) return [];
		const parsed = JSON.parse(
			new TextDecoder().decode(manifestBytes.subarray(0, length)),
		);
		if (Atomics.load(manifestHeader, 0) === before) return parsed;
	}
}

function syncManifest() {
	if (manifestHeader === undefined) return;
	const version = Atomics.load(manifestHeader, 0);
	if (version === manifestVersion) return;
	manifestVersion = version;
	const entries = readManifest();
	const wanted = new Map(entries.map((entry) => [entry.dir, entry]));
	for (const dir of [...watched.keys()])
		if (!wanted.has(dir)) watched.delete(dir);
	for (const [dir, seed] of wanted)
		if (!watched.has(dir)) watched.set(dir, { seed, lastPost: null });
}

const TASK_FILE = "task.json";
const RESULT_FILE = "result.json";
const STATUS_FILE = "status.json";
const CANCELLED_FILE = "cancelled.json";
const DELIVERED_FILE = "delivered.json";
const LIVE_SOCK = "live.sock";
const SAFE_SOCKET_PATH_LIMIT = 100;
const START_GRACE_MS = 30_000;
const TICK_MS = 1000;

function liveSocketPath(runDir) {
	const direct = join(runDir, LIVE_SOCK);
	if (direct.length <= SAFE_SOCKET_PATH_LIMIT) return direct;
	const digest = createHash("sha1").update(direct).digest("hex").slice(0, 16);
	return join(tmpdir(), `pi-sw-live-${digest}.sock`);
}

function probeLiveSocket(path) {
	return new Promise((resolve) => {
		const socket = connect(path);
		const done = (value) => {
			socket.destroy();
			resolve(value);
		};
		socket.setTimeout(500, () => done(false));
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
	});
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** dir -> { seed, lastPost } — lastPost doubles as the change filter. */
const watched = new Map();
let timer = undefined;

function post(message) {
	parentPort.postMessage(message);
}

function signature(entry) {
	const { state, status, outcome } = entry;
	return JSON.stringify([
		state,
		status?.updatedAt,
		status?.currentIndex,
		status?.success,
		status?.completed,
		status?.total,
		status?.pid,
		outcome?.completedAt ?? null,
		outcome?.cancelled ?? null,
	]);
}

function ownerMismatch(dir, seed) {
	const record = readJson(join(dir, TASK_FILE));
	return (
		record !== undefined &&
		typeof record.ownerSessionId === "string" &&
		record.ownerSessionId !== seed.sessionId
	);
}

async function classify(dir, seed) {
	if (!existsSync(dir)) {
		// Abnormal disappearance — unless another session rebuilt the path,
		// which makes it a NotMy special case of the disappearance.
		if (ownerMismatch(dir, seed))
			return { state: "not-my", detail: "dir rebuilt by another session" };
		return { state: "vanished" };
	}
	// Continuous ownership check: a watched dir that turned foreign mid-watch
	// (removed + rebuilt under another session id) is NotMy, not ours to track.
	const record = readJson(join(dir, TASK_FILE));
	if (
		record !== undefined &&
		typeof record.ownerSessionId === "string" &&
		record.ownerSessionId !== seed.sessionId
	)
		return { state: "not-my", detail: `owner ${record.ownerSessionId}` };
	const outcome = readJson(join(dir, RESULT_FILE));
	const cancelled = readJson(join(dir, CANCELLED_FILE));
	const delivered = readJson(join(dir, DELIVERED_FILE));
	if (cancelled !== undefined || outcome?.cancelled === true)
		return { state: "cancelled", outcome };
	if (delivered !== undefined) return { state: "done", outcome };
	if (outcome !== undefined) return { state: "pendingDelivery", outcome };
	const status = readJson(join(dir, STATUS_FILE));
	const alive =
		status === undefined
			? Date.now() - seed.startedAt < START_GRACE_MS
			: await probeLiveSocket(liveSocketPath(dir));
	return { state: alive ? "running" : "lost", status };
}

async function tick() {
	syncManifest();
	if (watched.size === 0) {
		// Recycle: the list emptied (every run reached a terminal state and
		// left). Announce and leave explicitly — parentPort listeners hold the
		// worker's event loop open, so a full, prompt exit must be deliberate.
		post({ type: "idle-exit" });
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		process.exit(0);
	}
	for (const [dir, entry] of [...watched]) {
		let classified;
		try {
			classified = await classify(dir, entry.seed);
		} catch (error) {
			watched.delete(dir);
			post({
				type: "error",
				err: {
					kind: "unreadable",
					taskId: entry.seed.taskId,
					runId: entry.seed.runId,
					dir,
					detail: String(error?.message ?? error),
				},
			});
			continue;
		}
		const { state } = classified;
		if (state === "not-my" || state === "vanished") {
			watched.delete(dir);
			post({
				type: "error",
				err:
					state === "not-my"
						? {
								kind: "not-my",
								taskId: entry.seed.taskId,
								dir,
								detail: classified.detail,
							}
						: { kind: "vanished", taskId: entry.seed.taskId, runId: entry.seed.runId, dir },
			});
			continue;
		}
		if (state === "done" || state === "cancelled") {
			watched.delete(dir);
			post({
				type: "finish",
				dir,
				taskId: entry.seed.taskId,
				runId: entry.seed.runId,
				how: state === "done" ? "delivered" : "cancelled",
			});
			continue;
		}
		const next = {
			state,
			status: classified.status ?? null,
			outcome: classified.outcome ?? null,
		};
		if (signature(next) !== entry.lastPost) {
			entry.lastPost = signature(next);
			post({
				type: "state",
				run: {
					dir,
					taskId: entry.seed.taskId,
					runId: entry.seed.runId,
					startedAt: entry.seed.startedAt,
					state: next.state,
					status: next.status,
					outcome: next.outcome,
				},
			});
		}
	}
}

function armTimer() {
	if (timer !== undefined) return;
	timer = setInterval(() => {
		void tick();
	}, TICK_MS);
	// Ref'd on purpose: this interval is the worker's own heartbeat. The
	// main side unref()s the Worker object, so the PROCESS can still exit
	// without asking us; within the worker only explicit recycle exits.
}

// The worker only exists because the manifest had work; arm immediately.
armTimer();
