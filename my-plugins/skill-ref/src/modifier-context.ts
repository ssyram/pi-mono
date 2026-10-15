import type { ModifierContext, ModifierSeparator } from "./reference-modifier.js";
import { REFERENCE_PATTERN, REFERENCE_START } from "./reference-pattern.js";

/** First non-whitespace position across all lines, or null when every line is blank. */
function firstMeaningfulPosition(lines: string[]): { line: number; col: number } | null {
	for (let line = 0; line < lines.length; line++) {
		const col = lines[line]!.search(/\S/);
		if (col !== -1) return { line, col };
	}
	return null;
}

export function extractModifierContext(lines: string[], cursorLine: number, cursorCol: number): ModifierContext | null {
	const beforeCursor = lines[cursorLine]!.slice(0, cursorCol);
	const pattern = new RegExp(`${REFERENCE_START}(${REFERENCE_PATTERN})([ \\t]*)(\\\\?)(:{1,2})([a-z]*)$`);
	const match = pattern.exec(beforeCursor);
	if (!match) return null;
	const reference = match[2]!;
	const gap = match[3]!;
	const separator = match[5] as ModifierSeparator;
	const referenceStart = match.index + match[1]!.length;
	// The leading reference of the first meaningful line belongs to pi's native
	// command handling (user ruling 2026-10-14): no modifier context there.
	const official = firstMeaningfulPosition(lines);
	if (official !== null && official.line === cursorLine && referenceStart === official.col) return null;
	if (!gap && separator === ":" && /^\/(skill|prompt)$/i.test(reference)) return null;
	const start = referenceStart + reference.length + gap.length;
	return {
		reference,
		start,
		prefix: beforeCursor.slice(start),
		separator,
		escaped: match[4] !== "",
		fragment: match[6]!,
	};
}
