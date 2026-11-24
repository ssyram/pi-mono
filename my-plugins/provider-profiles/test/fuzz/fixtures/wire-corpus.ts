/**
 * Seeded wire-form corpus for parseCatalog/readOverlayModel fuzz
 * (robustness-and-proof.md §3A). Every case pairs a payload with an
 * INDEPENDENT expectation derived from the acceptance contract — which
 * records the contract says must survive or be dropped — never from running
 * the validation code under test. Boundary values (id length 200/301,
 * tokens 0/1, NaN/Infinity) are exercised at the direct unknown boundary.
 */

import type { Provider } from "@earendil-works/pi-ai";
import { instanceProvider } from "../../../instantiator.js";
import { getBase } from "../../../provider-source.js";
import type { CatalogSource } from "../../../official-catalog/catalog-contracts.js";
import { resolveCatalogSource } from "../../../official-catalog/catalog-source.js";
import type { FuzzRng } from "./fuzz-rng.js";

export interface RecordMutation {
	readonly name: string;
	readonly drop: boolean;
	patch(record: Record<string, unknown>, rng: FuzzRng): void;
}

const UNICODE = "ä油̶\u202e🌍";

export const RECORD_MUTATIONS: readonly RecordMutation[] = [
	{ name: "id-removed", drop: true, patch: (r) => void delete r.id },
	{ name: "id-empty", drop: true, patch: (r) => void (r.id = "") },
	{ name: "id-not-string", drop: true, patch: (r) => void (r.id = 42) },
	{ name: "id-length-200", drop: false, patch: (r) => void (r.id = "x".repeat(200)) },
	{ name: "id-length-201", drop: true, patch: (r) => void (r.id = "x".repeat(201)) },
	{ name: "id-unicode", drop: false, patch: (r) => void (r.id = `glm-${UNICODE}`) },
	{ name: "name-removed", drop: true, patch: (r) => void delete r.name },
	{ name: "name-empty", drop: true, patch: (r) => void (r.name = "") },
	{ name: "name-length-301", drop: true, patch: (r) => void (r.name = "n".repeat(301)) },
	{ name: "type-embedding", drop: true, patch: (r) => void (r.type = "embedding") },
	{ name: "type-voice", drop: true, patch: (r) => void (r.type = "voice") },
	{ name: "type-video", drop: true, patch: (r) => void (r.type = "video") },
	{ name: "type-unknown-op", drop: true, patch: (r) => void (r.type = "operate") },
	{ name: "api-wrong", drop: true, patch: (r) => void (r.api = "anthropic-messages") },
	{ name: "api-removed", drop: true, patch: (r) => void delete r.api },
	{ name: "provider-mismatch", drop: true, patch: (r) => void (r.provider = "other-source") },
	{ name: "baseurl-mismatch", drop: true, patch: (r) => void (r.baseUrl = "https://evil.example/") },
	{ name: "reasoning-not-bool", drop: true, patch: (r) => void (r.reasoning = "yes") },
	{ name: "context-zero", drop: true, patch: (r) => void (r.contextWindow = 0) },
	{ name: "context-negative", drop: true, patch: (r) => void (r.contextWindow = -1024) },
	{ name: "context-nan", drop: true, patch: (r) => void (r.contextWindow = Number.NaN) },
	{ name: "context-infinity", drop: true, patch: (r) => void (r.contextWindow = Number.POSITIVE_INFINITY) },
	{ name: "context-string", drop: true, patch: (r) => void (r.contextWindow = "1024") },
	{ name: "context-one", drop: false, patch: (r) => void (r.contextWindow = 1) },
	{ name: "maxtokens-zero", drop: true, patch: (r) => void (r.maxTokens = 0) },
	{ name: "maxtokens-negative", drop: true, patch: (r) => void (r.maxTokens = -131072) },
	{ name: "cost-removed", drop: true, patch: (r) => void delete r.cost },
	{ name: "cost-negative-rate", drop: true, patch: (r) => void (r.cost = { input: -1, output: 2, cacheRead: 0, cacheWrite: 0 }) },
	{ name: "cost-missing-rate", drop: true, patch: (r) => void (r.cost = { input: 1, output: 2 }) },
	{ name: "cost-rate-string", drop: true, patch: (r) => void (r.cost = { input: "1", output: 2, cacheRead: 0, cacheWrite: 0 }) },
	{ name: "cost-tiers-not-array", drop: true, patch: (r) => void (r.cost = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: 3 }) },
	{ name: "cost-tier-zero-threshold", drop: true, patch: (r) => void (r.cost = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 0, input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }] }) },
	{ name: "cost-valid-tiers", drop: false, patch: (r) => void (r.cost = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5, tiers: [{ inputTokensAbove: 1000, input: 0.5, output: 1, cacheRead: 0, cacheWrite: 0 }] }) },
	{ name: "thinking-level-number", drop: true, patch: (r) => void (r.thinkingLevelMap = { low: 3 }) },
	{ name: "thinking-level-null", drop: false, patch: (r) => void (r.thinkingLevelMap = { low: null }) },
	{ name: "thinking-map-array", drop: true, patch: (r) => void (r.thinkingLevelMap = ["low"]) },
	{ name: "input-no-text", drop: true, patch: (r) => void (r.input = ["image"]) },
	{ name: "input-audio", drop: true, patch: (r) => void (r.input = ["text", "audio"]) },
	{ name: "input-not-array", drop: true, patch: (r) => void (r.input = "text") },
	{ name: "input-text-image", drop: false, patch: (r) => void (r.input = ["text", "image"]) },
	{ name: "compat-string", drop: true, patch: (r) => void (r.compat = "yes") },
	{ name: "compat-record", drop: false, patch: (r) => void (r.compat = { reasoningBaseline: "auto" }) },
	{ name: "headers-injected", drop: false, patch: (r) => void (r.headers = { authorization: "synthetic" }) },
	{ name: "extra-unknown-field", drop: false, patch: (r, rng) => void (r[`x_${rng.int(3)}`] = { nested: UNICODE }) },
	{ name: "__proto__-key", drop: false, patch: (r) => void (r.reserved = "__proto__") },
];

const GARBAGE: readonly unknown[] = [null, 17, "model", true, [], [1], Number.NaN];

export function zaiFixtureSource(): CatalogSource {
	const instance = instanceProvider(getBase("zai"), { name: "zai-fuzz-source", provider: "zai" });
	const source = resolveCatalogSource(instance, "zai");
	if (source === undefined) throw new Error("zai fuzz source failed to resolve");
	return source;
}

export function validRecord(source: CatalogSource, id: string): Record<string, unknown> {
	const template = getBase("zai").getModels()[0] as unknown as Record<string, unknown>;
	return { ...template, id, name: `Fuzz ${id}`, provider: source.sourceId, baseUrl: source.endpoint };
}

export interface WireCase {
	readonly payload: unknown;
	readonly expectInvalid: boolean;
	readonly keptIds: readonly string[];
	readonly label: string;
}

function entryFor(source: CatalogSource, rng: FuzzRng, index: number): { record: unknown; kept: boolean; id: string } {
	const id = `m${index}-${rng.int(10)}`;
	if (rng.bool(0.12)) return { record: rng.pick(GARBAGE), kept: false, id: "" };
	const record = validRecord(source, id);
	const mutation = rng.pick(RECORD_MUTATIONS);
	mutation.patch(record, rng);
	const effective = mutation.drop ? id : (record.id as string);
	return { record, kept: !mutation.drop, id: effective };
}

export function wireCase(source: CatalogSource, rng: FuzzRng, index: number): WireCase {
	const length = 1 + rng.int(4);
	const entries = Array.from({ length }, (_, i) => entryFor(source, rng, index * 10 + i));
	const labels = entries.map((e) => (e.record === undefined ? "garbage" : RECORD_MUTATIONS.length + ""));
	const keptIds = entries.filter((e) => e.kept).map((e) => e.id);
	const form = rng.int(3);
	if (form === 0) return { payload: entries.map((e) => e.record), expectInvalid: false, keptIds, label: `array[${labels}]` };
	if (form === 1) return { payload: { models: entries.map((e) => e.record) }, expectInvalid: false, keptIds, label: `models[${labels}]` };
	const map: Record<string, unknown> = {};
	entries.forEach((e, i) => {
		map[`k${i}`] = e.record;
	});
	return { payload: map, expectInvalid: entries.some((e) => !e.kept), keptIds, label: `map[${labels}]` };
}
