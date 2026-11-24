/**
 * Overlay entry validation at the wire/cache trust boundary
 * (docs/official-catalog-sync.md P/M acceptance conditions). The same checks
 * apply to pi.dev responses and cached snapshots. Entries failing any check
 * are dropped before they can reach the original call path; headers are
 * always stripped so catalog data can never inject request headers.
 */

import type { Api } from "@earendil-works/pi-ai";
import type { CatalogSource, OverlayModel } from "./catalog-contracts.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function positiveFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validatedRates(value: Record<string, unknown>): boolean {
	const { input, output, cacheRead, cacheWrite } = value;
	return (
		nonNegativeFinite(input) && nonNegativeFinite(output) && nonNegativeFinite(cacheRead) && nonNegativeFinite(cacheWrite)
	);
}

/** Cost must be legal: the four required rates, and optional tiers with the
 * same rate shape plus a finite threshold. */
function validatedCost(value: unknown): true | undefined {
	if (!isRecord(value)) return undefined;
	if (!validatedRates(value)) return undefined;
	if (value.tiers === undefined) return true;
	if (!Array.isArray(value.tiers)) return undefined;
	for (const tier of value.tiers) {
		if (!isRecord(tier) || !positiveFinite(tier.inputTokensAbove) || !validatedRates(tier)) return undefined;
	}
	return true;
}

function validatedThinkingMap(value: unknown): true | undefined {
	if (value === undefined) return true;
	if (!isRecord(value)) return undefined;
	for (const level of Object.values(value)) {
		if (level !== null && typeof level !== "string") return undefined;
	}
	return true;
}

/** Input support: text/image modalities; text must be present. */
function validatedInput(value: unknown): true | undefined {
	if (!Array.isArray(value) || !value.includes("text")) return undefined;
	return value.every((modality) => modality === "text" || modality === "image") ? true : undefined;
}

/**
 * Validates one untrusted catalog record against the adapted source. Returns
 * the model with headers stripped and the checked fields normalized, or
 * undefined to drop the entry. Unknown extra metadata fields (inputLimits,
 * samplingParams, …) pass through unchanged — metadata is inherited as-is,
 * never hand-transcribed.
 */
export function readOverlayModel(value: unknown, source: CatalogSource): OverlayModel | undefined {
	if (!isRecord(value)) return undefined;
	const id = boundedString(value.id, 200);
	if (id === undefined) return undefined;
	const name = boundedString(value.name, 300);
	if (name === undefined) return undefined;
	if (value.type !== undefined && value.type !== "chat") return undefined;
	if (typeof value.api !== "string" || !source.apiSet.includes(value.api)) return undefined;
	if (value.provider !== source.sourceId) return undefined;
	if (value.baseUrl !== source.endpoint) return undefined;
	if (typeof value.reasoning !== "boolean") return undefined;
	if (!positiveFinite(value.contextWindow) || !positiveFinite(value.maxTokens)) return undefined;
	if (validatedCost(value.cost) === undefined) return undefined;
	if (validatedThinkingMap(value.thinkingLevelMap) === undefined) return undefined;
	if (validatedInput(value.input) === undefined) return undefined;
	if (value.compat !== undefined && !isRecord(value.compat)) return undefined;
	const { headers: _headers, ...rest } = value;
	return rest as unknown as OverlayModel;
}
