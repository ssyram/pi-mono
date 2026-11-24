/**
 * Fuzz C (robustness-and-proof.md §3): 256 seeded sequences × 32 steps
 * against the real createCatalogOwner/refreshModels lifecycle via fake
 * clock/fetch (fixtures/lifecycle-harness.ts). Per-step invariants: base
 * models always listed, disposed instances revert and never publish new
 * ids, single-flight, no unhandled rejections, warnings deduped, failure-
 * free sequences stay silent, restart recovers committed snapshots.
 * Sampled evidence, not a universal proof. Replay: PP_FUZZ_SEED=<seed>
 * node ../../node_modules/vitest/dist/cli.js run test/fuzz/official-catalog-lifecycle-fuzz.test.ts
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { Provider } from "@earendil-works/pi-ai";
import { createCatalogOwner } from "../../official-catalog/catalog-owner.js";
import { readCatalogCache } from "../../official-catalog/catalog-cache.js";
import { catalogCachePath } from "../../official-catalog/catalog-source.js";
import { instanceProvider } from "../../instantiator.js";
import { getBase } from "../../provider-source.js";
import { FuzzRng, seedFromEnv } from "./fixtures/fuzz-rng.js";
import { refreshContext, resetHarness, settle, SUCCESS_TTL_MS, type SequenceState } from "./fixtures/lifecycle-harness.js";
import { zaiFixtureSource } from "./fixtures/wire-corpus.js";

const SEQUENCES = 256;
const STEPS = 32;
const NORMAL_SEQUENCES = 16;
const NORMAL_OPS = ["compose", "cache-only", "net-fresh", "net-stale", "force", "force-double", "takeover", "attach", "clock+"] as const;
const SEED = seedFromEnv("PP_FUZZ_SEED", 0x5eed1f);
const baseIds = getBase("zai").getModels().map((model) => model.id);
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
	unhandled.push(reason);
};
const OPS = [
	"compose", "cache-only", "net-fresh", "net-stale", "force", "force-double", "takeover", "stale-catalog",
	"304", "304-then-200", "no-data", "rate-limit", "http-5xx", "invalid-json", "attach-bad-notify",
	"attach-bad-updated", "attach", "dispose", "late-job", "double-dispose", "compose-after-dispose", "clock+",
] as const;
const NOISY = new Set(["rate-limit", "http-5xx", "invalid-json", "attach-bad-notify", "attach-bad-updated", "304"]);

function idsOf(state: SequenceState, name: string): string[] {
	return (state.instances?.find((entry) => entry.name === name)?.provider.getModels() ?? []).map((model) => model.id);
}

function assertInvariants(state: SequenceState & { instances: { name: string; provider: { getModels: () => { id: string }[] } }[] }, step: number, seq: number): void {
	expect(unhandled, `seq ${seq} step ${step} unhandled`).toEqual([]);
	for (const entry of state.instances) {
		const ids = idsOf(state, entry.name);
		for (const id of baseIds) expect(ids, `seq ${seq} step ${step} base ${id}`).toContain(id);
		const allowed = state.disposed ? state.visibleAtDispose : state.visible;
		for (const id of ids) expect(baseIds.includes(id) || allowed.has(id), `seq ${seq} step ${step} id ${id}`).toBe(true);
		if (state.disposed) expect([...new Set(ids)].sort(), `seq ${seq} step ${step} disposed reverts`).toEqual([...baseIds].sort());
	}
	expect(state.updatedAfterDispose, `seq ${seq} step ${step} post-dispose publish`).toEqual([]);
}

async function takeoverInCache(agentDir: string, takeoverId: string): Promise<boolean> {
	const result = await readCatalogCache(catalogCachePath(agentDir, "zai"), zaiFixtureSource());
	return result.type === "hit" && result.cache.models.some((model) => model.id === takeoverId);
}

test(`lifecycle fuzz: ${SEQUENCES}x${STEPS} seeded sequences keep identity/publication/warning invariants`, { timeout: 300_000 }, async () => {
	process.on("unhandledRejection", onUnhandled);
	let silentRuns = 0;
	try {
		const rng = new FuzzRng(SEED);
		for (let seq = 0; seq < SEQUENCES + NORMAL_SEQUENCES; seq += 1) {
			const agentDir = await mkdtemp(join(tmpdir(), "pp-fuzz-life-"));
			const state: SequenceState & { instances: { name: string; provider: Provider }[] } = {
				owner: undefined, agentDir, clock: 1_000_000, mode: "takeover", takeoverId: `takeover-${seq}`,
				calls: 0, deferred: undefined, notifications: [], resolutions: 0, attachedOnce: false, updates: [], updatedAfterDispose: [], disposed: false,
				visible: new Set<string>(baseIds), visibleAtDispose: new Set<string>(baseIds), committedTakeover: undefined,
				writeBlocked: seq < SEQUENCES && rng.bool(0.15), instances: [],
			};
			state.owner = createCatalogOwner(agentDir, {
				fetch: resetHarness(state),
				now: () => state.clock,
				generatedAt: () => 0,
			});
			if (state.writeBlocked) await mkdir(catalogCachePath(agentDir, "zai"), { recursive: true });
			const noisy = new Set<string>();
			const netOp = async (mode: SequenceState["mode"]): Promise<void> => {
				state.mode = mode;
				noisy.add(mode);
				const callsBefore = state.calls;
				await state.instances[0].provider.refreshModels?.(refreshContext(true, true));
				await settle();
				const jobRan = state.calls > callsBefore;
				state.committedTakeover = mode === "takeover" && !state.writeBlocked && jobRan ? state.takeoverId : mode === "stale-catalog" || mode === "no-data" ? undefined : state.committedTakeover;
			};
			const composeInstance = async (): Promise<void> => {
				const name = `inst-${seq}-${state.instances.length}`;
				const fresh = instanceProvider(getBase("zai"), { name, provider: "zai" });
				state.instances.push({ name, provider: await state.owner?.compose(fresh, "zai") ?? fresh });
			};
			await composeInstance();
			for (let step = 0; step < STEPS; step += 1) {
				const op = seq < SEQUENCES ? rng.pick(OPS) : rng.pick(NORMAL_OPS);
				if (op === "compose" || op === "compose-after-dispose") await composeInstance();
				else if (op === "cache-only") await state.instances[0].provider.refreshModels?.(refreshContext(false));
				else if (op === "net-fresh") await state.instances[0].provider.refreshModels?.(refreshContext(true));
				else if (op === "net-stale" || op === "clock+") {
					state.clock += SUCCESS_TTL_MS + 1000;
					if (op === "net-stale") {
						const callsBeforeStale = state.calls;
						await state.instances[0].provider.refreshModels?.(refreshContext(true));
						await settle();
						const staleMode = state.mode;
						const ranStale = state.calls > callsBeforeStale;
						if (ranStale && staleMode === "takeover" && !state.writeBlocked) state.committedTakeover = state.takeoverId;
						if (ranStale && (staleMode === "stale-catalog" || staleMode === "no-data")) state.committedTakeover = undefined;
					}
				} else if (op === "force") await netOp(state.mode);
				else if (op === "takeover" || op === "stale-catalog" || op === "304" || op === "304-then-200" || op === "no-data" || op === "rate-limit" || op === "http-5xx" || op === "invalid-json") await netOp(op);
				else if (op === "force-double") {
					const before = state.calls;
					await state.instances[0].provider.refreshModels?.(refreshContext(true, true));
					await state.instances[0].provider.refreshModels?.(refreshContext(true, true));
					await settle();
					expect(state.calls - before, `seq ${seq} step ${step} single-flight`).toBeLessThan(3);
				} else if (op === "attach" || op === "attach-bad-notify" || op === "attach-bad-updated") {
					noisy.add(op);
					state.owner?.attach({
						notify: (message, level) => {
						state.notifications.push({ message, level, resolutions: state.resolutions, buffered: !state.attachedOnce });
							if (op === "attach-bad-notify") throw new Error("notify unavailable");
						},
						onUpdated: async (ids) => {
							if (state.disposed) state.updatedAfterDispose.push(`${ids.join(",")}`);
							state.updates.push(`${ids.join(",")}`);
							if (op === "attach-bad-updated") throw new Error("ui rejected");
						},
					});
					state.attachedOnce = true;
				} else if (op === "dispose" || op === "late-job") {
					if (op === "late-job") {
						state.mode = "deferred";
						await state.instances[0].provider.refreshModels?.(refreshContext(true, true));
					}
					if (!state.disposed) {
						state.disposed = true;
						state.visibleAtDispose = new Set(state.visible);
					}
					state.owner?.dispose();
					if (op === "late-job") {
						state.deferred?.resolve();
						await settle();
					}
				} else if (op === "double-dispose") state.owner?.dispose();
				for (const entry of state.instances) for (const id of idsOf(state, entry.name)) state.visible.add(id);
				assertInvariants(state, step, seq);
			}
			const direct = state.notifications.filter((entry) => !entry.buffered);
			for (let i = 0; i < direct.length; i += 1) {
				for (let j = i + 1; j < direct.length; j += 1) {
					if (direct[i].message !== direct[j].message) continue;
					expect(direct[j].resolutions, `seq ${seq} duplicate warning without recovery`).toBeGreaterThan(direct[i].resolutions);
				}
			}
			if ([...noisy].every((op) => !NOISY.has(op)) && !state.writeBlocked) {
				expect(state.notifications, `seq ${seq} failure-free path silent`).toEqual([]);
				silentRuns += 1;
			}
			if (!state.writeBlocked) {
				const restart = createCatalogOwner(agentDir, { fetch: async () => new Response(null, { status: 500 }), now: () => state.clock, generatedAt: () => 0 });
				const restarted = await restart.compose(instanceProvider(getBase("zai"), { name: `restart-${seq}`, provider: "zai" }), "zai");
				const restartIds = restarted.getModels().map((model) => model.id);
				// A committed snapshot may survive disposal before the old session observes it.
				for (const id of restartIds) expect(baseIds.includes(id) || id === state.takeoverId, `seq ${seq} restart source id ${id}`).toBe(true);
				if (state.committedTakeover !== undefined && !state.disposed) {
					await vi.waitFor(async () => expect(await takeoverInCache(agentDir, state.takeoverId), `seq ${seq} restart recovers committed takeover`).toBe(true));
				}
				restart.dispose();
			}
			state.owner?.dispose();
			await rm(agentDir, { force: true, recursive: true });
		}
		expect(silentRuns, "some sequences must exercise failure-free silence").toBeGreaterThan(10);
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
});
