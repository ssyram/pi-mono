/**
 * Entry store — pi's skill/prompt list with a background rescan.
 *
 * `entries()` is what every consumer reads: synchronous, never throws, never
 * waits. When the TTL has elapsed it starts one rescan (single flight) and keeps
 * serving the current list; a rescan that changes the list swaps it in and
 * reports the change through the notice given at session start. Nothing here
 * holds a timer, watcher or child process between calls, so `pi -p` still exits.
 *
 * The rescan is a throwaway replica of pi's loader, and a replica can disagree
 * with pi (an untrusted project, paths pi was handed on its command line). It is
 * therefore only trusted after it has reproduced pi's live list once, on a
 * session start where pi itself had just read the disk. In every other session
 * the store serves pi's list untouched — exactly the behavior without this file.
 *
 * The list is a property of the working directory, not of the session, so the
 * trust verdict carries across session starts; every start still re-anchors the
 * list to pi whenever pi has reloaded.
 */

import { type EntryDelta, formatDelta, nameDelta, sameEntries } from "./entry-diff.js";
import type { SkillRefEntry } from "./registry.js";

export type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

export interface EntryStore {
	/** Current list; starts a background rescan when stale. Never throws. */
	entries(): SkillRefEntry[];
	/** Waits for a rescan that stale-triggering starts, up to `timeoutMs`; then returns whatever is current. */
	refreshed(timeoutMs: number): Promise<SkillRefEntry[]>;
	/** Re-anchors to pi's list; calibrates the rescan when pi has just read the disk. */
	begin(reason: SessionStartReason, notify: (message: string) => void): void;
}

export interface EntryStoreDeps {
	/** pi's own list, as `getCommands()` reports it right now. */
	read: () => SkillRefEntry[];
	/** The disk view, through pi's loader. */
	rescan: () => Promise<SkillRefEntry[]>;
	ttlMs: number;
}

export function createEntryStore(deps: EntryStoreDeps): EntryStore {
	let current = safeRead();
	let trusted = false;
	let lastScanAt = 0;
	let inFlight: Promise<void> | undefined;
	let notify: ((message: string) => void) | undefined;

	function safeRead(): SkillRefEntry[] {
		try {
			return deps.read() ?? [];
		} catch {
			return [];
		}
	}

	function isStale(): boolean {
		return Date.now() - lastScanAt >= deps.ttlMs;
	}

	// lastScanAt is stamped at start, not at end: a rescan that fails must not be
	// retried on every keystroke.
	function scan(apply: (fresh: SkillRefEntry[]) => void): Promise<void> {
		lastScanAt = Date.now();
		let run: Promise<void>;
		run = deps
			.rescan()
			.then(apply, () => {})
			.finally(() => {
				if (inFlight === run) inFlight = undefined;
			});
		inFlight = run;
		return run;
	}

	function applyRefresh(fresh: SkillRefEntry[]): void {
		if (!trusted || sameEntries(current, fresh)) return;
		const delta: EntryDelta = nameDelta(current, fresh);
		current = fresh;
		const message = formatDelta(delta);
		if (message) notify?.(message);
	}

	function refreshIfStale(): void {
		if (trusted && !inFlight && isStale()) void scan(applyRefresh);
	}

	return {
		entries() {
			refreshIfStale();
			return current;
		},

		async refreshed(timeoutMs) {
			refreshIfStale();
			if (!inFlight) return current;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timedOut = new Promise<SkillRefEntry[]>((resolve) => {
				timer = setTimeout(() => resolve(current), timeoutMs);
			});
			try {
				return await Promise.race([inFlight.then(() => current), timedOut]);
			} finally {
				clearTimeout(timer);
			}
		},

		begin(reason, notifyFn) {
			notify = notifyFn;
			// Only a session start right after pi read the disk can tell a faithful
			// replica from an unfaithful one; other starts keep the verdict.
			if (reason !== "startup" && reason !== "reload") return;
			current = safeRead();
			trusted = false;
			void scan((fresh) => {
				// pi extends its list right after session_start (resources_discover), so
				// the comparison must read pi's side once the rescan has settled too.
				const live = safeRead();
				current = live;
				trusted = sameEntries(live, fresh);
			});
		},
	};
}
