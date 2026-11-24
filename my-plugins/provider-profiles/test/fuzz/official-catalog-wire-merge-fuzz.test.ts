/**
 * Fuzz A+B (robustness-and-proof.md §3): ≥10,000 seeded cases directly
 * against the real parseCatalog/readOverlayModel/mergeOfficial product
 * functions. Expectations are contract-derived (which record classes the
 * acceptance contract keeps/drops; merge invariants), never the product's
 * own classification replayed back. Green here is sampled evidence, not a
 * universal proof. Replay: PP_FUZZ_SEED=<seed> node ../../node_modules/
 * vitest/dist/cli.js run test/fuzz/official-catalog-wire-merge-fuzz.test.ts
 */

import { expect, test } from "vitest";
import type { Model, Api } from "@earendil-works/pi-ai";
import { parseCatalog } from "../../official-catalog/catalog-parse.js";
import { mergeOfficial } from "../../official-catalog/catalog-merge.js";
import { readOverlayModel } from "../../official-catalog/overlay-model.js";
import type { OverlayModel } from "../../official-catalog/catalog-contracts.js";
import { instanceProvider } from "../../instantiator.js";
import { getBase } from "../../provider-source.js";
import { FuzzRng, seedFromEnv } from "./fixtures/fuzz-rng.js";
import { validRecord, wireCase, zaiFixtureSource } from "./fixtures/wire-corpus.js";

const WIRE_CASES = 7000;
const MERGE_CASES = 3500;
const SEED = seedFromEnv("PP_FUZZ_SEED", 20261117);

const source = zaiFixtureSource();

function keyOf(model: { type?: string; id: string }): string {
	return `${model.type ?? "chat"}\0${model.id}`;
}

function snapshot(value: unknown): string {
	return JSON.stringify(value);
}

function checkedModels(models: readonly OverlayModel[]): void {
	for (const model of models) {
		expect(model.provider, "wire model provider").toBe(source.sourceId);
		expect(source.apiSet, "wire model api").toContain(model.api);
		expect(model.baseUrl, "wire model endpoint").toBe(source.endpoint);
		expect((model as unknown as Record<string, unknown>).headers, "stripped headers").toBeUndefined();
		expect(Number.isFinite(model.contextWindow) && model.contextWindow > 0, "contextWindow").toBe(true);
		expect(Number.isFinite(model.maxTokens) && model.maxTokens > 0, "maxTokens").toBe(true);
	}
}

test(`parseCatalog fuzz: ${WIRE_CASES} seeded wire cases honor contract drop/keep classes`, () => {
	const rng = new FuzzRng(SEED);
	let keptTotal = 0;
	for (let index = 0; index < WIRE_CASES; index += 1) {
		const wire = wireCase(source, rng, index);
		const result = parseCatalog(wire.payload, source);
		if (wire.expectInvalid) {
			expect(result.type, `case ${index} ${wire.label} must be invalid`).toBe("invalid");
			continue;
		}
		expect(result.type, `case ${index} ${wire.label}`).toBe("valid");
		if (result.type !== "valid") continue;
		checkedModels(result.models);
		const ids = new Set(result.models.map((model) => model.id));
		const expected = new Set(wire.keptIds);
		expect([...ids].sort(), `case ${index} kept ids`).toEqual([...expected].sort());
		keptTotal += result.models.length;
		if (index % 10 === 0) {
			const again = parseCatalog(JSON.parse(snapshot(wire.payload)), source);
			expect(again.type).toBe("valid");
			if (again.type === "valid") {
				expect([...new Set(again.models.map((m) => m.id))].sort()).toEqual([...ids].sort());
			}
		}
	}
	expect(keptTotal, "corpus must exercise accepted records").toBeGreaterThan(1000);
});

function overlayEntry(id: string): OverlayModel {
	const model = readOverlayModel(validRecord(source, id), source);
	if (model === undefined) throw new Error(`overlay fixture ${id} unexpectedly invalid`);
	return model;
}

test(`mergeOfficial fuzz: ${MERGE_CASES} seeded merges preserve contract invariants`, () => {
	const rng = new FuzzRng(SEED + 1);
	const basePool = instanceProvider(getBase("zai"), { name: "zai-merge-fuzz", provider: "zai" }).getModels() as readonly Model<Api>[];
	const instanceId = "zai-merge-fuzz";
	for (let index = 0; index < MERGE_CASES; index += 1) {
		const baseStart = rng.int(basePool.length);
		const base = basePool.slice(baseStart, baseStart + 1 + rng.int(4));
		const overlayCount = rng.int(5);
		const overlayIds = Array.from({ length: overlayCount }, (_, i) =>
			rng.bool(0.4) && i < base.length ? base[i].id : `over-${index}-${i}`,
		);
		const overlay = overlayIds.map(overlayEntry);
		const baseCopy = snapshot(base);
		const overlayCopy = snapshot(overlay);
		const merged = mergeOfficial(base, overlay, instanceId);
		expect(snapshot(base), `case ${index} base untouched`).toBe(baseCopy);
		expect(snapshot(overlay), `case ${index} overlay untouched`).toBe(overlayCopy);
		expect(merged.every((model) => model.provider === instanceId), `case ${index} restamped`).toBe(true);
		const keys = merged.map(keyOf);
		expect(new Set(keys).size, `case ${index} unique identities`).toBe(keys.length);
		const mergedByKey = new Map(merged.map((model) => [keyOf(model), model]));
		const overlayByKey = new Map(overlay.map((model) => [keyOf(model), model]));
		for (const model of base) {
			const winner = mergedByKey.get(keyOf(model));
			expect(winner, `case ${index} base id ${model.id} preserved`).toBeDefined();
			if (!overlayByKey.has(keyOf(model))) expect(winner?.name).toBe(model.name);
		}
		for (const [key, model] of overlayByKey) {
			const winner = mergedByKey.get(key);
			expect(winner?.name, `case ${index} overlay priority for ${key}`).toBe(model.name);
		}
		const baseOnlyOrder = merged.filter((model) => !overlayByKey.has(keyOf(model)));
		const expectedOrder = base.filter((model) => !overlayByKey.has(keyOf(model)));
		expect(baseOnlyOrder.map((model) => model.id), `case ${index} base order`).toEqual(expectedOrder.map((model) => model.id));
		const again = mergeOfficial(merged, overlay, instanceId);
		expect(again.map((m) => `${keyOf(m)}=${m.name}`).sort(), `case ${index} idempotent`).toEqual(
			merged.map((m) => `${keyOf(m)}=${m.name}`).sort(),
		);
		const other = mergeOfficial(base, overlay, "other-instance");
		expect(other.every((model) => model.provider === "other-instance"), `case ${index} isolated restamp`).toBe(true);
		expect(snapshot(mergeOfficial(base, [], instanceId)), `case ${index} empty overlay`).toBe(snapshot(base));
	}
});
