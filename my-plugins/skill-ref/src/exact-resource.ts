import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { findExact } from "./match.js";
import type { SkillRefEntry } from "./registry.js";

export interface LoadedResource {
	entry: SkillRefEntry;
	content: string;
}

export type ResourceReader = (entry: SkillRefEntry) => string;

export function loadExactReference(
	entries: SkillRefEntry[],
	query: string,
	read: ResourceReader = (entry) => readFileSync(entry.path, "utf-8"),
): LoadedResource | null {
	try {
		const matches = findExact(entries, query);
		if (matches.length !== 1) return null;
		const matched = matches[0]!;
		// Capture the validated path before the read: the reader receives the
		// caller's mutable object and may rewrite or sabotage it afterwards.
		const path = matched.path;
		if (typeof path !== "string" || !isAbsolute(path)) return null;
		const content = read(matched);
		if (typeof content !== "string") return null;
		return { entry: { ...matched, path }, content };
	} catch {
		return null;
	}
}
