/**
 * Official catalog parsing (docs/official-catalog-sync.md D3). Accepts the
 * three wire shapes the official host reader accepts — an array, an object
 * with a `models` array, or a plain model-object map (Object.values) — with
 * every entry still validated individually. The plain-object form is a model
 * map: any value that is not a valid model record makes the whole payload
 * invalid, so an arbitrary error object can never parse as a valid empty
 * catalog. Traversal is finite; entries of unknown operations never enter
 * the chat list (readOverlayModel drops non-chat types).
 */

import type { CatalogSource, OverlayModel, ParseResult } from "./catalog-contracts.js";
import { isRecord, readOverlayModel } from "./overlay-model.js";

function parseEntries(entries: readonly unknown[], source: CatalogSource): OverlayModel[] {
	const models: OverlayModel[] = [];
	for (const entry of entries) {
		const model = readOverlayModel(entry, source);
		if (model !== undefined) models.push(model);
	}
	return models;
}

export function parseCatalog(value: unknown, source: CatalogSource): ParseResult {
	if (Array.isArray(value)) return { type: "valid", models: parseEntries(value, source) };
	if (isRecord(value)) {
		if (Array.isArray(value.models)) return { type: "valid", models: parseEntries(value.models, source) };
		const models: OverlayModel[] = [];
		for (const entry of Object.values(value)) {
			const model = readOverlayModel(entry, source);
			if (model === undefined) return { type: "invalid" };
			models.push(model);
		}
		return { type: "valid", models };
	}
	return { type: "invalid" };
}
