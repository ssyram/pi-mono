// Main-thread owner of the run-watch worker. Two mailboxes, zero addressing:
// out-box = worker postMessage events buffered here for the dispatcher tick
// to drain; in-box = the shared watch manifest, which only this side mounts.
// Spawning is the tick's decision alone: manifest non-empty and no worker
// registered -> start one (it reads the manifest itself, so respawn needs no
// re-delivery). A worker's exit only de-registers; nothing is ever lost
// because the box outlives every recipient.
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { RunOutcome, RunStatus } from "../script-tasks/run-record.js";
import {
	createWatchManifest,
	type ManifestEntry,
	type WatchManifest,
} from "./watch-manifest.js";

export type WatchSeed = ManifestEntry;

export type WatchedRun = {
	taskId: string;
	runId: string;
	dir: string;
	startedAt: number;
	state: "running" | "pendingDelivery" | "lost";
	status?: RunStatus | undefined;
	outcome?: RunOutcome | undefined;
};

/** Worker -> main out-box events. "idle-exit" is the recycle announcement. */
export type RunEvent =
	| { type: "state"; run: WatchedRun }
	| { type: "idle-exit" }
	| {
			type: "finish";
			dir: string;
			taskId: string;
			runId: string;
			how: "delivered" | "cancelled";
	  }
	| {
			type: "error";
			err:
				| { kind: "not-my"; taskId: string; dir: string; detail: string }
				| { kind: "vanished"; taskId: string; runId: string; dir: string }
				| {
						kind: "unreadable";
						taskId: string;
						runId: string;
						dir: string;
						detail: string;
				  };
	  };

export type RunWatcher = {
	/** Mount into the in-box; the tick decides whether a worker is needed. */
	watch(seed: WatchSeed): void;
	/** Remove from the in-box; the worker's next scan drops the dir. */
	unwatch(dir: string): void;
	poll(): readonly RunEvent[];
	snapshot(): readonly WatchedRun[];
	dispose(): void;
};

/** Minimal worker surface so tests can substitute a fake. */
export type WorkerLike = {
	on(event: "message", handler: (message: unknown) => void): unknown;
	on(event: "exit", handler: (code: number) => void): unknown;
	terminate(): void;
};

export type SpawnWorker = (path: string, manifest: SharedArrayBuffer) => WorkerLike;

const WORKER_URL = new URL("./worker.mjs", import.meta.url);

export function createRunWatcher(
	spawnWorker: SpawnWorker = defaultSpawnWorker,
	manifest: WatchManifest = createWatchManifest(),
): RunWatcher {
	const seeds = new Map<string, ManifestEntry>();
	const runs = new Map<string, WatchedRun>();
	const events: RunEvent[] = [];
	let worker: WorkerLike | undefined;
	let disposed = false;
	let sawEmptyExit = false;

	const attach = (target: WorkerLike): void => {
		target.on("message", (message) => {
			const event = message as RunEvent;
			if (event?.type === "idle-exit") {
				sawEmptyExit = true;
				return;
			}
			if (event?.type === "state") {
				// A state event racing unwatch (stop/cancel) must not resurrect.
				if (!seeds.has(event.run.dir)) return;
				runs.set(event.run.dir, event.run);
				events.push(event);
			} else if (event?.type === "finish") {
				runs.delete(event.dir);
				seeds.delete(event.dir);
				events.push(event);
			} else if (event?.type === "error") {
				runs.delete(event.err.dir);
				seeds.delete(event.err.dir);
				events.push(event);
			}
		});
		target.on("exit", (code) => {
			if (worker !== target) return;
			// De-register only after full exit. Respawning stays the tick's
			// decision: the manifest is intact, a new worker re-reads it all.
			// Exit code 0 is the graceful recycle (the idle-exit message is a
			// best-effort diagnostic that an immediate exit may drop).
			worker = undefined;
			if (disposed || code === 0 || sawEmptyExit) return;
			sawEmptyExit = false;
			events.push({
				type: "error",
				err: {
					kind: "unreadable",
					taskId: "worker",
					runId: "worker",
					dir: "worker",
					detail: `run-watch worker exited unexpectedly (${code})`,
				},
			});
		});
	};

	/** Tick maintenance: mount pending seeds, spawn iff work waits and no
	 * worker is registered. Covers first use, recycle, and crash recovery. */
	const maintain = (): void => {
		if (seeds.size > 0) manifest.mount([...seeds.values()]);
		if (worker !== undefined || disposed || seeds.size === 0) return;
		sawEmptyExit = false;
		worker = spawnWorker(fileURLToPath(WORKER_URL), manifest.shared);
		attach(worker);
	};

	return {
		watch(seed) {
			if (disposed) return;
			seeds.set(seed.dir, seed);
			runs.set(seed.dir, {
				taskId: seed.taskId,
				runId: seed.runId,
				dir: seed.dir,
				startedAt: seed.startedAt,
				state: "running",
			});
			manifest.mount([...seeds.values()]);
		},
		unwatch(dir) {
			seeds.delete(dir);
			runs.delete(dir);
			manifest.mount([...seeds.values()]);
		},
		poll() {
			maintain();
			return events.splice(0, events.length);
		},
		snapshot() {
			return [...runs.values()];
		},
		dispose() {
			disposed = true;
			worker?.terminate();
		},
	};
}

function defaultSpawnWorker(path: string, manifest: SharedArrayBuffer): WorkerLike {
	const worker = new Worker(path, { workerData: { manifest } });
	// The worker must not keep pi's process alive by itself.
	worker.unref?.();
	return worker;
}
