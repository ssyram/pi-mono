import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const IMPRESSION_ENTRY_TYPE = "impression-v1";
export const PASSTHROUGH_MODE_ENTRY_TYPE = "impression-passthrough-mode";
export const SESSION_STATS_ENTRY_TYPE = "impression-session-stats";
export const IMPRESSION_CONFIG_ENTRY_TYPE = "impression-config-v1";
export const DEFAULT_MIN_LENGTH = 2048;
export const DEFAULT_MAX_RECALL = 1;
export const DEFAULT_MAX_PASSTHROUGH_COUNT = 2;
export const DEFAULT_DISTILL_RATE_FLOOR = 0.02;
export const DISTILLER_SENTINEL = "<passthrough/>";
export const CONFIG_FILE_NAME = "impression.json";

export type PromptVariant = "first-person" | "third-person";

export interface ImpressionConfig {
	"debug:distill-mode"?: PromptVariant;
	skipDistillation?: string[];
	minLength?: number;
	maxRecallBeforePassthrough?: number;
	maxPassthroughCount?: number;
	showData?: boolean;
	debug?: boolean;
	distillRateFloor?: number;
	enabled?: boolean;
}

export interface ResolvedConfig {
	debugDistillMode?: PromptVariant;
	skipDistillation: string[];
	minLength: number;
	maxRecall: number;
	maxPassthroughCount: number;
	showData: boolean;
	debug: boolean;
	distillRateFloor: number;
	enabled: boolean;
}

export interface ImpressionEntry {
	id: string;
	toolName: string;
	toolCallId: string;
	toolInput?: Record<string, unknown>;
	fullContent: (TextContent | ImageContent)[];
	fullText: string;
	originalChars?: number;
	recallCount: number;
	createdAt: number;
	/** True once the full content has been delivered to the LLM via passthrough. After delivery, `fullContent` and `fullText` are emptied — the LLM already has the content in its message history, so keeping it here would just inflate memory and the JSONL log. */
	delivered?: boolean;
}

export function isImpressionEntry(value: unknown): value is ImpressionEntry {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.id === "string" &&
		typeof record.toolName === "string" &&
		typeof record.toolCallId === "string" &&
		Array.isArray(record.fullContent) &&
		typeof record.fullText === "string" &&
		(record.originalChars === undefined || typeof record.originalChars === "number") &&
		typeof record.recallCount === "number" &&
		typeof record.createdAt === "number" &&
		(record.delivered === undefined || typeof record.delivered === "boolean")
	);
}

export interface ImpressionDetails {
	thinking?: string;
}

export interface PassthroughModeEntry {
	remaining: number;
	lastEstimatedChars?: number;
}

export interface SessionStatsEntry {
	originalChars: number;
	impressionChars: number;
}

export function isPassthroughModeEntry(value: unknown): value is PassthroughModeEntry {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return typeof record.remaining === "number" && (record.lastEstimatedChars === undefined || typeof record.lastEstimatedChars === "number");
}

export function isSessionStatsEntry(value: unknown): value is SessionStatsEntry {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return typeof record.originalChars === "number" && typeof record.impressionChars === "number";
}

export function getEntryData(entry: SessionEntry): unknown {
	if (entry.type !== "custom") return undefined;
	if (entry.customType !== IMPRESSION_ENTRY_TYPE) return undefined;
	return entry.data;
}

export function getPassthroughModeData(entry: SessionEntry): unknown {
	if (entry.type !== "custom") return undefined;
	if (entry.customType !== PASSTHROUGH_MODE_ENTRY_TYPE) return undefined;
	return entry.data;
}

export function getSessionStatsData(entry: SessionEntry): unknown {
	if (entry.type !== "custom") return undefined;
	if (entry.customType !== SESSION_STATS_ENTRY_TYPE) return undefined;
	return entry.data;
}

export function getImpressionConfigData(entry: SessionEntry): unknown {
	if (entry.type !== "custom") return undefined;
	if (entry.customType !== IMPRESSION_CONFIG_ENTRY_TYPE) return undefined;
	return entry.data;
}

export function isImpressionConfigPatch(value: unknown): value is Partial<ImpressionConfig> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
