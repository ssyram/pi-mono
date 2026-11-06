// The main->worker mailbox: a shared-memory watch manifest. The main thread
// is the only writer; workers (current or respawned) scan it every tick and
// diff it against their in-memory set. Nobody ever addresses a worker: the
// box outlives any recipient, so a dying or dead worker losing a "message"
// is not a thing — the next worker simply reads the full state.
//
// Layout: [version int32][byteLength int32][UTF-8 JSON bytes...] — write
// order bytes -> length -> version gives the single-writer reader a stable
// snapshot via the version fence (no lock needed).
export const MANIFEST_CAPACITY_BYTES = 256 * 1024;

export type ManifestEntry = {
	dir: string;
	taskId: string;
	runId: string;
	startedAt: number;
	sessionId: string;
};

export type WatchManifest = {
	/** Passed to spawned workers via workerData. */
	shared: SharedArrayBuffer;
	mount(entries: readonly ManifestEntry[]): void;
	read(): readonly ManifestEntry[];
};

export function createWatchManifest(): WatchManifest {
	const shared = new SharedArrayBuffer(8 + MANIFEST_CAPACITY_BYTES);
	const header = new Int32Array(shared, 0, 2);
	const bytes = new Uint8Array(shared, 8);
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	let version = 0;
	return {
		shared,
		mount(entries) {
			const payload = encoder.encode(JSON.stringify(entries));
			if (payload.byteLength > MANIFEST_CAPACITY_BYTES)
				throw new Error("watch manifest capacity exceeded");
			bytes.set(payload);
			Atomics.store(header, 1, payload.byteLength);
			Atomics.store(header, 0, ++version);
		},
		read() {
			for (;;) {
				const before = Atomics.load(header, 0);
				const length = Atomics.load(header, 1);
				if (length === 0) return [];
				const parsed = JSON.parse(
					decoder.decode(bytes.subarray(0, length)),
				) as ManifestEntry[];
				if (Atomics.load(header, 0) === before) return parsed;
			}
		},
	};
}
