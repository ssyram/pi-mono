/**
 * M2 match — the one place that defines what "matching a name" means.
 *
 * Query semantics (loose subsequence): "abc" means /.*a.*b.*c.*\/i, and "." / "*"
 * are wildcards rather than literals, so "x...a" and "x..a" both mean /.*x.*a.*\/i.
 */

import { fuzzyMatch } from "@earendil-works/pi-tui";
import type { EntryKind, SkillRefEntry } from "./registry.js";

const MATCH_ALL = /.*/i;

/** The kind prefix is a fixed keyword, so its case carries no information. */
const KIND_PREFIX = /^(skill|prompt):/i;

/** Splits "SKILL:Abc" into { kind: "skill", name: "Abc" } — prefix case-insensitive, name untouched. */
export function splitQualified(query: string): { kind: EntryKind; name: string } | null {
	const match = KIND_PREFIX.exec(query);
	if (!match) return null;
	return { kind: match[1]!.toLowerCase() as EntryKind, name: query.slice(match[0].length) };
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drops the wildcard characters; what remains are the characters that must appear in order. */
export function stripWildcards(query: string): string {
	return query.replace(/[.*]/g, "");
}

/** Trims and drops leading slashes, so "/foo", "  /foo" and "foo" are the same query. */
export function normalizeQuery(raw: string): string {
	return raw.trim().replace(/^\/+/, "");
}

/** Compiles a query into its loose-subsequence regex. Never throws on regex metacharacters. */
export function compileQuery(query: string): RegExp {
	const chars = [...stripWildcards(query)];
	if (chars.length === 0) return MATCH_ALL;
	return new RegExp(`.*${chars.map(escapeRegex).join(".*")}.*`, "i");
}

/**
 * Exact lookup on the name, with a case-insensitive kind prefix. Accepts the bare
 * name ("foo") and the qualified name ("skill:foo" / "SKILL:foo"). Returns every
 * hit — a skill and a prompt may share a name.
 *
 * The name is compared case-sensitively: pi dedupes through case-sensitive maps,
 * so "Abc" and "abc" can both exist, and folding their case would make the
 * qualified identifier — the very thing a caller is told to disambiguate with —
 * just as ambiguous as the bare name. The prefix is a fixed keyword, so its case
 * carries nothing and is ignored.
 *
 * Both readings are tried, so a resource literally named "skill:foo" is still
 * reachable by its own name.
 */
export function findExact(entries: SkillRefEntry[], raw: string): SkillRefEntry[] {
	const query = normalizeQuery(raw);
	if (!query) return [];

	const qualified = splitQualified(query);
	return entries.filter(
		(entry) =>
			entry.name === query || (qualified !== null && entry.kind === qualified.kind && entry.name === qualified.name),
	);
}

/**
 * Same lookup ignoring case. Used to *offer* matches, never to pick one: it is a
 * superset of findExact, so it shows the caller every spelling that could have
 * been meant.
 */
export function findExactIgnoringCase(entries: SkillRefEntry[], raw: string): SkillRefEntry[] {
	const query = normalizeQuery(raw).toLowerCase();
	if (!query) return [];
	return entries.filter(
		(entry) => entry.name.toLowerCase() === query || entry.qualifiedName.toLowerCase() === query,
	);
}

/**
 * Loose search. Names are matched first; descriptions only come into play when no
 * name matched at all, so a name hit is never buried under description noise.
 *
 * A kind prefix scopes the search ("skill:qp" searches skills for "qp"), which is
 * what makes a half-typed "/skill:qp" complete instead of dead-ending. If that
 * scoped reading finds nothing, the whole string is searched as a plain name.
 */
export function findFuzzy(entries: SkillRefEntry[], raw: string, limit: number): SkillRefEntry[] {
	const normalized = normalizeQuery(raw);
	const qualified = splitQualified(normalized);
	if (qualified) {
		const scoped = search(
			entries.filter((entry) => entry.kind === qualified.kind),
			qualified.name,
			limit,
		);
		if (scoped.length > 0) return scoped;
	}
	return search(entries, normalized, limit);
}

function search(entries: SkillRefEntry[], query: string, limit: number): SkillRefEntry[] {
	const pattern = compileQuery(query);

	const byName = entries.filter((entry) => pattern.test(entry.name));
	const pool = byName.length > 0 ? byName : entries.filter((entry) => pattern.test(`${entry.name} ${entry.description}`));
	if (pool.length === 0) return [];

	const stripped = stripWildcards(query);
	const scored = pool.map((entry, index) => {
		if (!stripped) return { entry, index, score: 0 };
		const match = fuzzyMatch(stripped, entry.name);
		return { entry, index, score: match.matches ? match.score : Number.POSITIVE_INFINITY };
	});

	// Total order: score, then shorter name, then name, then original position.
	scored.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		if (a.entry.name.length !== b.entry.name.length) return a.entry.name.length - b.entry.name.length;
		if (a.entry.name !== b.entry.name) return a.entry.name < b.entry.name ? -1 : 1;
		return a.index - b.index;
	});

	return scored.slice(0, Math.max(1, limit)).map((item) => item.entry);
}
