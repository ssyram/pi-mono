import { type LoadedResource, loadExactReference, type ResourceReader } from "./exact-resource.js";
import { formatPrintedResources } from "./printed-resources.js";
import { parseReferenceOccurrences } from "./reference-occurrences.js";
import type { SkillRefEntry } from "./registry.js";

export function transformReferences(text: string, entries: SkillRefEntry[], read?: ResourceReader): string {
	const fragments: string[] = [];
	const printed = new Map<string, string>();
	const loaded = new Map<string, LoadedResource | null>();
	// The first meaningful line's leading reference belongs to pi's native command
	// handling (user ruling 2026-10-14): keep it verbatim, modifier included.
	const officialStart = text.search(/\S/);
	let offset = 0;
	for (const occurrence of parseReferenceOccurrences(text)) {
		fragments.push(text.slice(offset, occurrence.start));
		if (occurrence.start === officialStart) {
			fragments.push(text.slice(occurrence.start, occurrence.end));
			offset = occurrence.end;
			continue;
		}
		if (occurrence.escapeIndex !== null) {
			fragments.push(
				text.slice(occurrence.start, occurrence.escapeIndex),
				text.slice(occurrence.escapeIndex + 1, occurrence.end),
			);
		} else {
			if (!loaded.has(occurrence.reference)) {
				loaded.set(occurrence.reference, loadExactReference(entries, occurrence.reference, read));
			}
			const resource = loaded.get(occurrence.reference);
			if (!resource) {
				fragments.push(text.slice(occurrence.start, occurrence.end));
			} else if (occurrence.operation === "path") {
				fragments.push(resource.entry.path);
			} else {
				fragments.push(occurrence.reference);
				if (!printed.has(resource.entry.path)) printed.set(resource.entry.path, resource.content);
			}
		}
		offset = occurrence.end;
	}
	fragments.push(text.slice(offset));
	return fragments.join("") + formatPrintedResources([...printed.values()]);
}
