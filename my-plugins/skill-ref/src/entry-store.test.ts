import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEntryStore, type EntryStore, type SessionStartReason } from "./entry-store.js";
import type { SkillRefEntry } from "./registry.js";

function entry(name: string): SkillRefEntry {
	return { kind: "skill", name, qualifiedName: `skill:${name}`, description: "", path: `/${name}/SKILL.md` };
}

interface Pending {
	resolve(entries: SkillRefEntry[]): void;
	reject(error: unknown): void;
}

function harness(options: { ttlMs?: number; read?: () => SkillRefEntry[] } = {}): {
	store: EntryStore;
	notices: string[];
	scans(): number;
	begin(reason?: SessionStartReason): void;
	settle(entries: SkillRefEntry[]): Promise<void>;
	fail(error: unknown): Promise<void>;
	tick(): Promise<void>;
} {
	let scans = 0;
	let pending: Pending | undefined;
	const notices: string[] = [];
	const store = createEntryStore({
		read: options.read ?? ((): SkillRefEntry[] => [entry("a")]),
		rescan: () => {
			scans += 1;
			return new Promise<SkillRefEntry[]>((resolve, reject) => {
				pending = { resolve, reject };
			});
		},
		ttlMs: options.ttlMs ?? 0,
	});
	const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
	return {
		store,
		notices,
		scans: () => scans,
		begin: (reason = "startup") => store.begin(reason, (message) => notices.push(message)),
		settle: async (entries) => {
			assert.ok(pending, "a rescan must be in flight");
			pending.resolve(entries);
			pending = undefined;
			await tick();
		},
		fail: async (error) => {
			assert.ok(pending, "a rescan must be in flight");
			pending.reject(error);
			pending = undefined;
			await tick();
		},
		tick,
	};
}

/** Starts up with a rescan that reproduces pi's list, so later scans are trusted. */
async function calibrated(ttlMs?: number): Promise<ReturnType<typeof harness>> {
	const h = harness({ ttlMs });
	h.begin();
	await h.settle([entry("a")]);
	return h;
}

describe("createEntryStore", () => {
	it("serves pi's list and never throws when read fails before pi is bound", async () => {
		const h = harness({
			read: () => {
				throw new Error("before session_start");
			},
		});
		h.begin();
		await h.settle([entry("a")]);
		assert.deepEqual(h.store.entries(), []);
		assert.equal(h.scans(), 1);
	});

	it("trusts the rescan once it reproduces pi's list at startup", async () => {
		const h = await calibrated();
		h.store.entries();
		assert.equal(h.scans(), 2);
	});

	it("stays on pi's list when the rescan disagrees at startup", async () => {
		const h = harness();
		h.begin();
		await h.settle([entry("b")]);
		h.store.entries();
		h.store.entries();
		assert.equal(h.scans(), 1);
		assert.deepEqual(h.store.entries(), [entry("a")]);
	});

	it("swaps in a changed list and announces +N/-N", async () => {
		const h = await calibrated();
		h.store.entries();
		await h.settle([entry("a"), entry("c")]);
		assert.deepEqual(h.store.entries(), [entry("a"), entry("c")]);
		assert.deepEqual(h.notices, ["Skill list changed: +1/-0 skill(s)"]);
	});

	it("announces a plain change when the counts match", async () => {
		const h = await calibrated();
		h.store.entries();
		await h.settle([entry("b")]);
		assert.deepEqual(h.notices, ["Skill list changed"]);
	});

	it("stays silent when nothing changed", async () => {
		const h = await calibrated();
		h.store.entries();
		await h.settle([entry("a")]);
		assert.deepEqual(h.notices, []);
	});

	it("keeps the current list and stays silent when a rescan fails", async () => {
		const h = await calibrated();
		h.store.entries();
		await h.fail(new Error("disk gone"));
		assert.deepEqual(h.store.entries(), [entry("a")]);
		assert.deepEqual(h.notices, []);
		await h.settle([entry("a")]);
	});

	it("runs one rescan at a time", async () => {
		const h = await calibrated();
		h.store.entries();
		h.store.entries();
		h.store.entries();
		assert.equal(h.scans(), 2);
		await h.settle([entry("a")]);
	});

	it("does not rescan within the TTL", async () => {
		const h = await calibrated(Number.POSITIVE_INFINITY);
		h.store.entries();
		assert.equal(h.scans(), 1);
	});

	it("keeps the verdict across new/resume/fork and recalibrates on reload", async () => {
		const h = await calibrated();
		h.begin("new");
		h.begin("resume");
		h.begin("fork");
		assert.equal(h.scans(), 1);
		h.begin("reload");
		assert.equal(h.scans(), 2);
		await h.settle([entry("a")]);
	});

	it("calibrates against the list pi reports once the rescan settles, not the one at session_start", async () => {
		let live: SkillRefEntry[] = [];
		const h = harness({ read: () => live });
		h.begin();
		// pi extends its own list right after session_start.
		live = [entry("a")];
		await h.settle([entry("a")]);
		assert.deepEqual(h.store.entries(), [entry("a")]);
		h.store.entries();
		assert.equal(h.scans(), 2);
		await h.settle([entry("a")]);
	});
});

describe("refreshed", () => {
	it("waits for the rescan and returns the fresh list", async () => {
		const h = await calibrated();
		const pending = h.store.refreshed(1_000);
		await h.settle([entry("a"), entry("c")]);
		assert.deepEqual(await pending, [entry("a"), entry("c")]);
	});

	it("answers from the current list when the rescan is too slow", async () => {
		const h = await calibrated();
		assert.deepEqual(await h.store.refreshed(5), [entry("a")]);
		await h.settle([entry("a")]);
	});

	it("answers immediately within the TTL", async () => {
		const h = await calibrated(Number.POSITIVE_INFINITY);
		assert.deepEqual(await h.store.refreshed(1_000), [entry("a")]);
		assert.equal(h.scans(), 1);
	});
});
