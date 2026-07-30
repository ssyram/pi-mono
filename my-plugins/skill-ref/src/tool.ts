/**
 * M4 tool — try_load_skill_or_prompt.
 *
 * Exact name hit returns the resource's own text; anything else returns loose
 * search results so the model can converge on the right name by itself.
 *
 * Identifiers are always `skill:NAME` or `prompt:NAME`. pi already dedupes skills
 * by name and prompts by name (skills.ts:410-427 / resource-loader.ts:913-936,
 * first wins, loser dropped), so that pair is globally unique and no path-level
 * identifier is ever needed.
 *
 * Listings deliberately omit file paths: loading through this tool — rather than
 * through a generic file read — keeps the whole resource-loading channel
 * identifiable by tool name, which is what lets other extensions treat it
 * specially. Paths appear only in a successful load, where baseDir is needed to
 * resolve the resource's own relative references.
 */

import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { findExact, findExactIgnoringCase, findFuzzy, normalizeQuery } from "./match.js";
import type { SkillRefEntry } from "./registry.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_NAME_LISTING = 100;

const PARAMS = Type.Object({
	query: Type.String({
		description:
			"'skill:NAME', 'prompt:NAME', or a bare NAME. A leading '/' is ignored and the kind prefix is case-insensitive; NAME itself is not. When nothing matches exactly the name is matched loosely: 'abc' means .*a.*b.*c.*, and '.'/'*' act as wildcards, so 'x...a' means .*x.*a.*.",
	}),
	limit: Type.Optional(
		Type.Number({ description: `Max candidates listed when there is no exact match (default ${DEFAULT_LIMIT}).` }),
	),
});

export interface LoadDetails {
	mode: "exact" | "ambiguous" | "candidates" | "none";
	query: string;
	matched: string | null;
	path: string | null;
	contentLength: number | null;
	candidates: string[];
}

export interface LoadResult {
	text: string;
	details: LoadDetails;
}

export interface LoadQuery {
	query: string;
	limit?: number;
}

export function formatCollapsedResult(details: LoadDetails): string {
	if (details.mode === "exact" && details.matched && details.path && details.contentLength !== null) {
		return `/${details.matched} loaded successfully from ${details.path} — ${details.contentLength} chars`;
	}
	const count = details.candidates.length;
	return `Not loaded — ${count} candidate SKILL${count === 1 ? "" : "s"} found`;
}

function isLoadDetails(value: unknown): value is LoadDetails {
	if (typeof value !== "object" || value === null) return false;
	return (
		"mode" in value &&
		(value.mode === "exact" || value.mode === "ambiguous" || value.mode === "candidates" || value.mode === "none") &&
		"query" in value &&
		typeof value.query === "string" &&
		"matched" in value &&
		(value.matched === null || typeof value.matched === "string") &&
		"path" in value &&
		(value.path === null || typeof value.path === "string") &&
		"contentLength" in value &&
		(value.contentLength === null ||
			(typeof value.contentLength === "number" && Number.isSafeInteger(value.contentLength) && value.contentLength >= 0)) &&
		"candidates" in value &&
		Array.isArray(value.candidates) &&
		value.candidates.every((candidate) => typeof candidate === "string")
	);
}

/** Reads one resource file. Throws — the tool runner turns that into an error result. */
export function readResource(entry: SkillRefEntry): string {
	if (!entry.path) {
		throw new Error(`${entry.qualifiedName} has no file path registered with pi`);
	}
	try {
		return readFileSync(entry.path, "utf-8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`failed to read ${entry.path}: ${message}`);
	}
}

/** The surface form of an identifier, identical everywhere it is shown. */
function identifier(entry: SkillRefEntry): string {
	return `/${entry.qualifiedName}`;
}

function describe(entry: SkillRefEntry): string {
	const description = entry.description ? ` — ${entry.description}` : "";
	return `- ${identifier(entry)}${description}`;
}

function formatExact(entry: SkillRefEntry, content: string): string {
	return `${identifier(entry)} loaded successfully from ${entry.path}\n${content}`;
}

function formatMatches(query: string, hits: SkillRefEntry[]): string {
	const head =
		hits.length > 1
			? `"${query}" does not resolve to exactly one resource. Identifiers matching it (ignoring case):`
			: `"${query}" has no exact match. Identifier matching it (ignoring case):`;
	return [head, ...hits.map(describe), "", "Call again with one of these exact identifiers to load it."].join("\n");
}

function formatCandidates(query: string, candidates: SkillRefEntry[]): string {
	return [
		`No skill or prompt is named "${query}". Closest matches:`,
		...candidates.map(describe),
		"",
		"Call again with one of these exact identifiers to load it.",
	].join("\n");
}

function formatNone(query: string, entries: SkillRefEntry[]): string {
	if (entries.length === 0) {
		return `No skill or prompt is loaded in this session, so "${query}" cannot be resolved.`;
	}

	const names = entries.slice(0, MAX_NAME_LISTING).map(identifier);
	const omitted = entries.length - names.length;
	const tail = omitted > 0 ? `\n(+${omitted} more not shown)` : "";
	return `Nothing matches "${query}". Available skills and prompts:\n${names.join(", ")}${tail}`;
}

/**
 * Pure resolution step: registry + query in, text + details out.
 * `read` is injectable so the branch logic can be tested without touching disk.
 */
export function resolveQuery(
	entries: SkillRefEntry[],
	params: LoadQuery,
	read: (entry: SkillRefEntry) => string = readResource,
): LoadResult {
	const query = normalizeQuery(params.query ?? "");
	const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(params.limit ?? DEFAULT_LIMIT)));

	// Load outright only on a unique exact-case hit. Anything else — several hits,
	// or only a different-case spelling — is offered rather than guessed at.
	const exact = findExact(entries, query);
	if (exact.length === 1) {
		const entry = exact[0]!;
		const content = read(entry);
		return {
			text: formatExact(entry, content),
			details: {
				mode: "exact",
				query,
				matched: entry.qualifiedName,
				path: entry.path,
				contentLength: content.length,
				candidates: [],
			},
		};
	}

	const matches = findExactIgnoringCase(entries, query);
	if (matches.length > 0) {
		return {
			text: formatMatches(query, matches),
			details: {
				mode: matches.length > 1 ? "ambiguous" : "candidates",
				query,
				matched: null,
				path: null,
				contentLength: null,
				candidates: matches.map((e) => e.qualifiedName),
			},
		};
	}

	const candidates = findFuzzy(entries, query, limit);
	if (candidates.length > 0) {
		return {
			text: formatCandidates(query, candidates),
			details: {
				mode: "candidates",
				query,
				matched: null,
				path: null,
				contentLength: null,
				candidates: candidates.map((e) => e.qualifiedName),
			},
		};
	}

	return {
		text: formatNone(query, entries),
		details: { mode: "none", query, matched: null, path: null, contentLength: null, candidates: [] },
	};
}

export function registerTryLoadTool(pi: ExtensionAPI, getEntries: () => SkillRefEntry[]): void {
	pi.registerTool({
		name: "try_load_skill_or_prompt",
		label: "Load Skill/Prompt",
		description:
			"Load the text of a skill or prompt the user referred to by name, typically a '/name' written mid-sentence. pi only expands slash commands at the very start of a message, so such a reference is inert text until this tool resolves it. A single exact match returns the resource's full text — treat it as instructions for the current task. Any other outcome returns matching identifiers ('/skill:NAME' / '/prompt:NAME'); call again with one of them, each is guaranteed to resolve uniquely.",
		promptSnippet: "Load the text of a skill or prompt referenced as /name",
		promptGuidelines: [
			"A '/name' that appears inside a user message rather than at its start is a skill or prompt reference: resolve it with try_load_skill_or_prompt before acting on the request.",
			"Load skills and prompts through try_load_skill_or_prompt rather than reading their files; if it answers with a list of identifiers, call it again with one of them.",
		],
		parameters: PARAMS,
		async execute(_toolCallId, params) {
			const { text, details } = resolveQuery(getEntries(), params);
			return { content: [{ type: "text", text }], details };
		},
		renderResult(result, { expanded }) {
			const content = result.content.find((item) => item.type === "text");
			const text = expanded
				? content?.text ?? ""
				: isLoadDetails(result.details)
					? formatCollapsedResult(result.details)
					: "Not loaded — 0 candidate SKILLs found";
			return new Text(text, 0, 0);
		},
	});
}
