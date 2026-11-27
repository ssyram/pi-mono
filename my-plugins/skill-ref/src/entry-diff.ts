/**
 * Difference between two entry lists, for the user-visible refresh notice.
 *
 * Identity is (qualifiedName, path): a moved file swaps the entry silently, while
 * a name appearing or disappearing is what the notice counts.
 */

import type { SkillRefEntry } from "./registry.js";

export interface EntryDelta {
	added: number;
	removed: number;
}

function keyOf(entry: SkillRefEntry): string {
	return `${entry.qualifiedName}\n${entry.path}`;
}

/** True when both lists hold the same (name, path) pairs. */
export function sameEntries(before: SkillRefEntry[], after: SkillRefEntry[]): boolean {
	if (before.length !== after.length) return false;
	const keys = new Set(before.map(keyOf));
	return after.every((entry) => keys.has(keyOf(entry)));
}

/** Counts names present only in `after` (added) or only in `before` (removed). */
export function nameDelta(before: SkillRefEntry[], after: SkillRefEntry[]): EntryDelta {
	const beforeNames = new Set(before.map((entry) => entry.qualifiedName));
	const afterNames = new Set(after.map((entry) => entry.qualifiedName));
	let added = 0;
	for (const name of afterNames) {
		if (!beforeNames.has(name)) added += 1;
	}
	let removed = 0;
	for (const name of beforeNames) {
		if (!afterNames.has(name)) removed += 1;
	}
	return { added, removed };
}

/** The notice text, or null when nothing changed. Equal counts read as a plain change. */
export function formatDelta(delta: EntryDelta): string | null {
	if (delta.added === 0 && delta.removed === 0) return null;
	if (delta.added === delta.removed) return "Skill list changed";
	return `Skill list changed: +${delta.added}/-${delta.removed} skill(s)`;
}
