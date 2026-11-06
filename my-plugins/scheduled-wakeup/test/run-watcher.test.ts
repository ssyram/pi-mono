import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createRunWatcher,
	type RunEvent,
	type WorkerLike,
} from "../src/run-watch/run-watcher.js";
import {
	createWatchManifest,
	type WatchManifest,
} from "../src/run-watch/watch-manifest.js";

function fakeWorkerFactory() {
	const workers: FakeWorker[] = [];
	class FakeWorker implements WorkerLike {
		messageHandler: ((message: unknown) => void) | undefined;
		exitHandler: ((code: number) => void) | undefined;
		terminated = false;
		manifest: SharedArrayBuffer | undefined;
		constructor(manifest: SharedArrayBuffer | undefined) {
			this.manifest = manifest;
			workers.push(this);
		}
		on(event: "message" | "exit", handler: never): unknown {
			if (event === "message") this.messageHandler = handler;
			else this.exitHandler = handler;
			return undefined;
		}
		terminate(): void {
			this.terminated = true;
		}
		emit(event: RunEvent): void {
			this.messageHandler?.(event);
		}
		crash(): void {
			this.exitHandler?.(1);
		}
	}
	const factory = (path: string, manifest: SharedArrayBuffer): WorkerLike =>
		new FakeWorker(manifest) as unknown as WorkerLike;
	return { factory, workers: workers as FakeWorker[] };
}

const seed = { dir: "/tmp/r1", taskId: "session:a", runId: "r1", startedAt: 1, sessionId: "s1" };

test("tick maintenance spawns a worker iff the manifest has work", () => {
	const { factory, workers } = fakeWorkerFactory();
	const watcher = createRunWatcher(factory);
	assert.equal(workers.length, 0, "no worker before any watch");
	watcher.watch(seed);
	assert.equal(workers.length, 0, "mounting alone never spawns");
	watcher.poll();
	assert.equal(workers.length, 1, "tick spawned on pending manifest");
	watcher.poll();
	assert.equal(workers.length, 1, "registered worker is not duplicated");
	watcher.dispose();
	assert.equal(workers[0]!.terminated, true);
});

test("crash de-registers silently for the next tick to recover", () => {
	const { factory, workers } = fakeWorkerFactory();
	const watcher = createRunWatcher(factory);
	watcher.watch(seed);
	watcher.poll();
	const first = workers[0]!;
	first.emit({ type: "state", run: { taskId: "session:a", runId: "r1", dir: "/tmp/r1", startedAt: 1, state: "running" } });
	assert.equal(watcher.poll().length, 1);

	first.crash();
	assert.equal(workers.length, 1, "exit handler never spawns");
	const events = watcher.poll();
	assert.equal(events[0]?.type, "error", "crash surfaces as an error event");
	assert.equal(workers.length, 2, "the tick recovered");
	watcher.dispose();
});

test("empty-exit is silent and nothing respawn follows an empty manifest", () => {
	const { factory, workers } = fakeWorkerFactory();
	const watcher = createRunWatcher(factory);
	watcher.watch(seed);
	watcher.poll();
	const worker = workers[0]!;
	worker.emit({ type: "finish", dir: seed.dir, taskId: "session:a", runId: "r1", how: "delivered" });
	assert.equal(watcher.poll().length, 1, "finish drained");
	worker.emit({ type: "idle-exit" });
	worker.crash();
	assert.equal(watcher.poll().length, 0, "graceful recycle is silent");
	assert.equal(workers.length, 1, "no work mounted: no respawn");
});

test("the in-box outlives recipients: late mounts reach the replacement", () => {
	const { factory, workers } = fakeWorkerFactory();
	const watcher = createRunWatcher(factory);
	watcher.watch(seed);
	watcher.poll();
	const dying = workers[0]!;
	// late mount during the drain window: never postMessaged anywhere
	watcher.watch({ ...seed, dir: "/tmp/r2", runId: "r2" });
	assert.equal(workers.length, 1, "no double-spawn while draining");
	dying.crash();
	watcher.poll();
	assert.equal(workers.length, 2, "tick spawned the replacement");
	watcher.dispose();
});

test("state events for unwatched dirs do not resurrect runs", () => {
	const { factory, workers } = fakeWorkerFactory();
	const watcher = createRunWatcher(factory);
	watcher.watch(seed);
	watcher.poll();
	watcher.unwatch(seed.dir);
	workers[0]!.emit({ type: "state", run: { taskId: "session:a", runId: "r1", dir: seed.dir, startedAt: 1, state: "running" } });
	assert.equal(watcher.snapshot().length, 0);
	watcher.dispose();
});

test("manifest round-trips entries through shared memory", () => {
	const manifest: WatchManifest = createWatchManifest();
	assert.deepEqual(manifest.read(), []);
	manifest.mount([seed]);
	assert.deepEqual(manifest.read(), [seed]);
	manifest.mount([]);
	assert.deepEqual(manifest.read(), []);
});
