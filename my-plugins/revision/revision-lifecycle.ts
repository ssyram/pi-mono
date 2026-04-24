import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { boundLlmInput, formatTruncationNotice } from "../bounded-llm-input.js";
import { generateRevisionRecap } from "./generate-revision-recap.js";
import { REVISION_TYPE, updateLiveState } from "./revision-state.js";
import type { RevisionLiveState } from "./types.js";

const VALID_MODES = new Set(["hidden-summary", "visible-summary", "no-summary"]);
const VALID_STATUSES = new Set(["running", "done", "error"]);

function isRevisionSnapshot(details: unknown): details is RevisionLiveState {
	if (typeof details !== "object" || details === null) return false;
	const value = details as Record<string, unknown>;
	if (typeof value.requestId !== "string") return false;
	if (typeof value.mode !== "string" || !VALID_MODES.has(value.mode)) return false;
	if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status)) return false;
	if (value.recap !== undefined && typeof value.recap !== "string") return false;
	if (value.error !== undefined && typeof value.error !== "string") return false;
	return true;
}

function collectNewEntries(branchAfter: SessionEntry[], leafBefore: string | null): SessionEntry[] {
	const previousLeafIndex = leafBefore ? branchAfter.findIndex((entry) => entry.id === leafBefore) : -1;
	if (previousLeafIndex < 0) return branchAfter;
	return branchAfter.slice(previousLeafIndex + 1);
}

function reconstructLiveStates(liveStates: Map<string, RevisionLiveState>, branch: SessionEntry[]): void {
	const next = new Map<string, RevisionLiveState>();
	for (const entry of branch) {
		if (entry.type !== "custom_message" || entry.customType !== REVISION_TYPE) continue;
		if (!isRevisionSnapshot(entry.details)) continue;
		next.set(entry.details.requestId, {
			requestId: entry.details.requestId,
			mode: entry.details.mode,
			status: entry.details.status,
			recap: entry.details.recap ?? "",
			error: entry.details.error,
		});
	}
	liveStates.clear();
	for (const [key, value] of next) liveStates.set(key, value);
}

async function generateBoundedRecap(params: {
	originalText: string;
	getSystemPrompt: () => string;
	recapModel: string;
	modelRegistry: ModelRegistry;
	maxChars: number;
}): Promise<string | null> {
	const boundedText = boundLlmInput(params.originalText, params.maxChars);
	const originalText = boundedText.truncated
		? `${formatTruncationNotice(boundedText.originalLength, params.maxChars)}\n\n${boundedText.text}`
		: boundedText.text;
	const systemPrompt = params.getSystemPrompt();
	const boundedSystemPrompt = boundLlmInput(systemPrompt, params.maxChars);
	const originalSystemPrompt = boundedSystemPrompt.truncated
		? `${formatTruncationNotice(boundedSystemPrompt.originalLength, params.maxChars)}\n\n${boundedSystemPrompt.text}`
		: boundedSystemPrompt.text;
	return generateRevisionRecap(originalText, originalSystemPrompt, params.recapModel, params.modelRegistry);
}

function fireRecapInBackground(params: {
	requestId: string;
	originalText: string;
	getSystemPrompt: () => string;
	recapModel: string;
	modelRegistry: ModelRegistry;
	liveStates: Map<string, RevisionLiveState>;
	maxChars: number;
}): void {
	void (async () => {
		try {
			if (!params.liveStates.has(params.requestId)) return;
			const recap = await generateBoundedRecap(params);
			if (!params.liveStates.has(params.requestId)) return;
			updateLiveState(params.liveStates, params.requestId, {
				status: "done",
				recap: recap ?? "Recap unavailable.",
			});
		} catch {
			updateLiveState(params.liveStates, params.requestId, {
				status: "error",
				error: "Recap generation failed.",
				recap: "Recap unavailable.",
			});
		}
	})();
}

export { collectNewEntries, fireRecapInBackground, generateBoundedRecap, reconstructLiveStates };
