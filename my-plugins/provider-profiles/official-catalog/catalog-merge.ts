/**
 * Pure catalog merge (docs/official-catalog-sync.md D4 + P/M). Same
 * type/id official overlay entries override the original catalog — the same
 * rule as the official pi.dev overlay — and the final provider is restamped
 * to the instance id. Inputs are never mutated; metadata objects are copied
 * by spread with provider rebound, never hand-transcribed. A repeated merge
 * is idempotent and an invalid (empty) overlay yields a value equivalent to
 * the original instance catalog.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { OverlayModel } from "./catalog-contracts.js";

/** Same identity rule as the official overlay merge (getModelType):
 * models without `type` are chat models. */
function identityKey(model: Model<Api>): string {
	return `${model.type ?? "chat"}\0${model.id}`;
}

export function mergeOfficial(
	base: readonly Model<Api>[],
	overlay: readonly OverlayModel[],
	instanceId: string,
): Model<Api>[] {
	const merged = new Map<string, Model<Api>>();
	for (const model of base) merged.set(identityKey(model), { ...model, provider: instanceId });
	for (const model of overlay) merged.set(identityKey(model), { ...model, provider: instanceId });
	return [...merged.values()];
}
