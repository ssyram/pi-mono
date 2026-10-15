import { REFERENCE_OPERATIONS, type ReferenceOccurrence, type ReferenceOperation } from "./reference-modifier.js";
import { REFERENCE_END, REFERENCE_PATTERN, REFERENCE_START } from "./reference-pattern.js";

export function parseReferenceOccurrences(text: string): ReferenceOccurrence[] {
	// Branch A: unescaped separator + full operation + end boundary.
	// Branch B: bare escape — backslash + separator, no operation, no end
	// requirement; the occurrence ends after the colons and whatever follows
	// stays verbatim (user ruling 2026-10-15).
	const pattern = new RegExp(
		`${REFERENCE_START}(${REFERENCE_PATTERN})([ \\t]*)(?:(:{1,2})(${REFERENCE_OPERATIONS.join("|")})${REFERENCE_END}|(\\\\)(:{1,2}))`,
		"g",
	);
	const occurrences: ReferenceOccurrence[] = [];
	for (const match of text.matchAll(pattern)) {
		const boundary = match[1]!;
		const reference = match[2]!;
		const gap = match[3]!;
		const start = match.index + boundary.length;
		const escapeIndex = match[6] !== undefined ? start + reference.length + gap.length : null;
		occurrences.push({
			start,
			end: match.index + match[0].length,
			reference,
			operation: escapeIndex !== null ? null : (match[5] as ReferenceOperation),
			escapeIndex,
		});
	}
	return occurrences;
}
