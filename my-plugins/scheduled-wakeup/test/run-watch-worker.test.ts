import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { test, type TestContext } from "node:test";
import { Worker } from "node:worker_threads";
import { setTimeout as sleep } from "node:timers/promises";
import {
	createWatchManifest,
	type ManifestEntry,
} from "../src/run-watch/watch-manifest.js";

const WORKER_URL = new URL("../src/run-watch/worker.mjs", import.meta.url);
const SESSION = "watch-test-session";

type WorkerEvent = {
	type: string;
	run?: { dir: string; state: string };
	how?: string;
	err?: { kind: string };
};

function makeRoot(t: TestContext): string {
	const root = mkdtempSync(join(tmpdir(), "run-watch-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function makeRunDir(root: string, taskId: string, runId: string, startedAt = Date.now()): string {
	const dir = join(root, taskId, runId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "task.json"),
		JSON.stringify({
			version: 1,
			taskId,
			scope: "session",
			payload: { prompt: "p" },
			ownerSessionId: SESSION,
			startedAt,
		}),
		"utf8",
	);
	return dir;
}

function writeJson(dir: string, name: string, body: unknown): void {
	writeFileSync(join(dir, name), JSON.stringify(body), "utf8");
}

/** Boots the worker against a real manifest box; mounting happens on the
 * main side only — the worker self-scans, exactly like production. */
function harness() {
	const manifest = createWatchManifest();
	const events: WorkerEvent[] = [];
	let worker: Worker | undefined;
	let exitedCode: number | undefined;
	const ensureWorker = (): void => {
		if (worker !== undefined && exitedCode === undefined) return;
		exitedCode = undefined;
		worker = new Worker(WORKER_URL, {
			workerData: { manifest: manifest.shared },
		});
		worker.on("message", (event: WorkerEvent) => events.push(event));
		worker.once("exit", (code: number) => {
			exitedCode = code;
		});
	};
	ensureWorker();
	return {
		get worker(): Worker {
			if (worker === undefined) throw new Error("no worker");
			return worker;
		},
		events,
		mount: (entries: readonly ManifestEntry[]) => {
			manifest.mount(entries);
			ensureWorker();
		},
		async exited(): Promise<number> {
			for (let i = 0; i < 150 && exitedCode === undefined; i++) await sleep(20);
			if (exitedCode === undefined) throw new Error("worker never exited");
			return exitedCode;
		},
		async collect(): Promise<WorkerEvent[]> {
			for (let i = 0; i < 150 && events.length === 0; i++) await sleep(20);
			return events.splice(0, events.length);
		},
		async dispose(): Promise<void> {
			await worker?.terminate();
		},
	};
}

test("worker walks running -> pendingDelivery -> done and removes terminal runs", async (t) => {
	const root = makeRoot(t);
	const dir = makeRunDir(root, "session:a", "r1");
	const h = harness();
	t.after(() => void h.dispose());
	const server: Server = createServer(() => undefined);
	await new Promise<void>((resolve) => server.listen(join(dir, "live.sock"), resolve));
	try {
		writeJson(dir, "status.json", { pid: 1, currentIndex: 0, success: 0, completed: 0, total: 1, updatedAt: Date.now() });
		h.mount([{ dir, taskId: "session:a", runId: "r1", startedAt: Date.now(), sessionId: SESSION }]);
		let events = await h.collect();
		assert.equal(events.find((e) => e.type === "state")?.run?.state, "running");
		events = await h.collect();
		assert.equal(events.filter((e) => e.type === "state").length, 0, "unchanged: no duplicate posts");

		writeJson(dir, "result.json", { cancelled: false, results: [], successCount: 1, shouldWake: false, completedAt: 1, content: "c" });
		events = await h.collect();
		assert.equal(events.find((e) => e.type === "state")?.run?.state, "pendingDelivery");

		writeJson(dir, "delivered.json", { sessionId: SESSION, deliveredAt: 1, how: "idle-send" });
		events = await h.collect();
		assert.equal(events.find((e) => e.type === "finish")?.how, "delivered");
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

test("worker reports vanished and not-my successor dirs", async (t) => {
	const root = makeRoot(t);
	const dir = makeRunDir(root, "session:b", "r1");
	const h = harness();
	t.after(() => void h.dispose());
	writeJson(dir, "status.json", { pid: 1, currentIndex: 0, success: 0, completed: 0, total: 1, updatedAt: Date.now() });
	h.mount([{ dir, taskId: "session:b", runId: "r1", startedAt: Date.now(), sessionId: SESSION }]);
	await h.collect();

	rmSync(dir, { recursive: true, force: true });
	let events = await h.collect();
	assert.equal(events.find((e) => e.type === "error")?.err?.kind, "vanished");

	// rebuilt under another session id -> continuous ownership check -> not-my
	const dir2 = makeRunDir(root, "session:c", "r1");
	writeJson(dir2, "task.json", { ownerSessionId: "another-session" });
	writeJson(dir2, "status.json", { pid: 1, currentIndex: 0, success: 0, completed: 0, total: 1, updatedAt: Date.now() });
	h.mount([{ dir: dir2, taskId: "session:c", runId: "r1", startedAt: Date.now(), sessionId: SESSION }]);
	events = await h.collect();
	assert.equal(events.find((e) => e.type === "error")?.err?.kind, "not-my");
});

test("worker announces empty-exit and ends once the manifest drains", async (t) => {
	const root = makeRoot(t);
	const dir = makeRunDir(root, "session:drain", "r1");
	const h = harness();
	writeJson(dir, "task.json", { ownerSessionId: SESSION });
	writeJson(dir, "result.json", { cancelled: true, results: [], successCount: 0, shouldWake: false, completedAt: 1, content: "c" });
	h.mount([{ dir, taskId: "session:drain", runId: "r1", startedAt: Date.now(), sessionId: SESSION }]);
	const events = await h.collect();
	assert.equal(events.find((e) => e.type === "finish")?.how, "cancelled");
	const code = await h.exited();
	assert.equal(code, 0, "graceful recycle exits 0");
});

test("a replacement worker picks up everything from the still-mounted box", async (t) => {
	const root = makeRoot(t);
	const dir = makeRunDir(root, "session:relay", "r1");
	const manifest = createWatchManifest();
	const spawn = () =>
		new Worker(WORKER_URL, { workerData: { manifest: manifest.shared } });
	writeJson(dir, "result.json", { cancelled: true, results: [], successCount: 0, shouldWake: false, completedAt: 1, content: "c" });
	// first worker drains the entry and recycles
	{
		const w = spawn();
		const events: WorkerEvent[] = [];
		w.on("message", (event: WorkerEvent) => events.push(event));
		manifest.mount([{ dir, taskId: "session:relay", runId: "r1", startedAt: Date.now(), sessionId: SESSION }]);
		await new Promise<void>((resolve) => w.once("exit", resolve));
		assert.equal(events.some((e) => e.type === "finish"), true);
	}
	// main mounts new work; the box never knew about worker lifetimes
	const dir2 = makeRunDir(root, "session:relay", "r2");
	writeJson(dir2, "result.json", { cancelled: true, results: [], successCount: 0, shouldWake: false, completedAt: 2, content: "c" });
	{
		const w = spawn();
		const events: WorkerEvent[] = [];
		w.on("message", (event: WorkerEvent) => events.push(event));
		manifest.mount([{ dir: dir2, taskId: "session:relay", runId: "r2", startedAt: Date.now(), sessionId: SESSION }]);
		const finished = new Promise<void>((resolve) =>
			w.on("message", (event: WorkerEvent) => {
				if (event.type === "finish") resolve();
			}),
		);
		await finished;
		assert.equal(events.some((e) => e.type === "finish"), true);
		await w.terminate();
	}
});
