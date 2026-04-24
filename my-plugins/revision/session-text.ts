import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { RevisionMode } from "./types.js";
import { REVISION_TYPE } from "./revision-state.js";

const VALID_MODES = new Set<RevisionMode>(["hidden-summary", "visible-summary", "no-summary"]);
const VALID_STATUSES = new Set(["running", "done", "error"]);

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part) {
					return typeof part.text === "string" ? part.text : "";
				}
				return "";
			})
			.join("\n");
	}
	return "";
}

function findTargetUserEntry(branch: SessionEntry[], upto: number): Extract<SessionEntry, { type: "message" }> | null {
	let seen = 0;
	for (let i = branch.length - 1; i >= 0; i -= 1) {
		const entry = branch[i];
		if (entry.type === "message" && entry.message.role === "user") {
			seen += 1;
			if (seen === upto) return entry;
		}
	}
	return null;
}

function collectReplacedEntries(branch: SessionEntry[], targetUserId: string): SessionEntry[] {
	const targetIndex = branch.findIndex((entry) => entry.id === targetUserId);
	if (targetIndex < 0) return [];
	return branch.slice(targetIndex + 1);
}

function buildEntriesText(entries: SessionEntry[]): string {
	const lines: string[] = [];
	for (const entry of entries) {
		if (entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant")) {
			const role = entry.message.role === "assistant" ? "ASSISTANT" : "ME";
			const text = extractTextContent(entry.message.content);
			if (text) lines.push(`${role}: ${text}`);
		} else if (entry.type === "branch_summary") {
			lines.push(`[branch summary]: ${entry.summary}`);
		} else if (entry.type === "compaction") {
			lines.push(`[compaction]: ${entry.summary}`);
		}
	}
	return lines.join("\n\n");
}

function isRevisionSnapshot(details: unknown): details is {
	requestId: string;
	mode: RevisionMode;
	status: "running" | "done" | "error";
	recap?: string;
	error?: string;
} {
	if (typeof details !== "object" || details === null) return false;
	const value = details as Record<string, unknown>;
	if (typeof value.requestId !== "string") return false;
	if (typeof value.mode !== "string" || !VALID_MODES.has(value.mode as RevisionMode)) return false;
	if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status)) return false;
	if (value.recap !== undefined && typeof value.recap !== "string") return false;
	if (value.error !== undefined && typeof value.error !== "string") return false;
	return true;
}

function collectRevisionSnapshots(branch: SessionEntry[]): Map<string, { mode: RevisionMode; status: "running" | "done" | "error"; recap: string; error?: string }> {
	const snapshots = new Map<string, { mode: RevisionMode; status: "running" | "done" | "error"; recap: string; error?: string }>();
	for (const entry of branch) {
		if (entry.type !== "custom_message" || entry.customType !== REVISION_TYPE) continue;
		if (!isRevisionSnapshot(entry.details)) continue;
		snapshots.set(entry.details.requestId, {
			mode: entry.details.mode,
			status: entry.details.status,
			recap: entry.details.recap ?? "",
			error: entry.details.error,
		});
	}
	return snapshots;
}

export { buildEntriesText, collectReplacedEntries, collectRevisionSnapshots, extractTextContent, findTargetUserEntry };
