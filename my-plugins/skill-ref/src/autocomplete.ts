/**
 * M3 autocomplete — takes over "/" + Tab in the middle of a sentence.
 *
 * The editor routes Tab two ways (packages/tui/src/components/editor.ts:2139):
 * a line-leading slash goes to the native command menu with force=false, anything
 * else goes to forceFileAutocomplete with force=true. So force===true is exactly
 * "not the line-leading slash menu", and intercepting it leaves the native menu
 * untouched.
 */

import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { findFuzzy } from "./match.js";
import type { EntryKind, SkillRefEntry } from "./registry.js";

/** Same token delimiters the built-in provider uses (PATH_DELIMITERS). */
const TOKEN_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);
const MAX_SUGGESTIONS = 50;

/** Structural view of pi's Theme; method syntax keeps the real Theme assignable. */
export interface ThemeLike {
	fg(color: string, text: string): string;
}

const KIND_COLOR: Record<EntryKind, string> = {
	skill: "accent",
	prompt: "success",
};

export interface InlineSlashToken {
	/** The token including its leading "/". */
	token: string;
	/** Column where the token starts on the cursor line. */
	start: number;
}

/**
 * Returns the token to complete, or null when this is not a mid-sentence "/" + Tab.
 *
 * Null cases, each protecting an existing behavior:
 * - not a forced (Tab) completion  -> native slash menu / typing triggers
 * - token does not start with "/"  -> @ attachments and plain path completion
 * - only whitespace to its left    -> line-leading slash, native menu's job
 */
export function extractInlineSlashToken(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	force: boolean,
): InlineSlashToken | null {
	if (!force) return null;

	const line = lines[cursorLine] ?? "";
	const beforeCursor = line.slice(0, cursorCol);

	let start = beforeCursor.length;
	while (start > 0 && !TOKEN_DELIMITERS.has(beforeCursor[start - 1] ?? "")) {
		start -= 1;
	}

	const token = beforeCursor.slice(start);
	if (!token.startsWith("/")) return null;
	if (beforeCursor.slice(0, start).trim() === "") return null;

	return { token, start };
}

function createColorizer(theme: ThemeLike | undefined): (color: string, text: string) => string {
	if (!theme) return (_color, text) => text;
	return (color, text) => {
		try {
			return theme.fg(color, text);
		} catch {
			return text;
		}
	};
}

function toItem(entry: SkillRefEntry, colorize: (color: string, text: string) => string): AutocompleteItem {
	// The kind tag carries the color. The description that follows re-states "muted"
	// explicitly so the surrounding wrapper (muted when idle, accent when selected)
	// cannot bleed past our foreground reset.
	const tag = colorize(KIND_COLOR[entry.kind], entry.kind);
	const rest = entry.description ? colorize("muted", ` · ${entry.description}`) : "";

	return {
		value: `/${entry.name}`,
		label: `/${entry.name}`,
		description: `${tag}${rest}`,
	};
}

/**
 * Wraps the current provider. Everything that is not a mid-sentence "/" + Tab is
 * delegated verbatim, so installing this plugin cannot change any other completion.
 */
export function createSkillRefProvider(
	current: AutocompleteProvider,
	getEntries: () => SkillRefEntry[],
	theme?: ThemeLike,
): AutocompleteProvider {
	const colorize = createColorizer(theme);

	return {
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const inline = extractInlineSlashToken(lines, cursorLine, cursorCol, options.force === true);
			if (!inline) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			if (options.signal?.aborted) return null;

			const matches = findFuzzy(getEntries(), inline.token.slice(1), MAX_SUGGESTIONS);
			// No match means no menu — deliberately not falling back to path completion.
			if (matches.length === 0) return null;

			return {
				items: matches.map((entry) => toItem(entry, colorize)),
				prefix: inline.token,
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const inline = extractInlineSlashToken(lines, cursorLine, cursorCol, true);
			const isOurs =
				inline !== null &&
				prefix === inline.token &&
				item.value.startsWith("/") &&
				getEntries().some((entry) => entry.name === item.value.slice(1));

			if (!inline || !isOurs) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}

			const line = lines[cursorLine] ?? "";
			const newLines = [...lines];
			newLines[cursorLine] = `${line.slice(0, inline.start)}${item.value} ${line.slice(cursorCol)}`;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: inline.start + item.value.length + 1,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}
