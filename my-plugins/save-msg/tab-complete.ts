/**
 * Tab completion for a slash command's own arguments.
 *
 * pi's built-in provider only offers a command's argument completions on a
 * natural (typing) trigger; pressing Tab after `/save-msg ` takes the forced
 * path and lists filesystem paths instead. Wrapping the provider lets both
 * routes answer with the same menu.
 *
 * Type-only imports keep this dependency-free at runtime.
 */

import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";

export interface ArgumentCandidate {
	value: string;
	description?: string;
}

export interface CommandArgumentOptions {
	/** Command name without the leading slash. */
	command: string;
	/**
	 * Candidates for the token being typed. `previousTokens` are the whitespace
	 * separated arguments already completed before it. Return null to hand the
	 * position back to the underlying provider (e.g. so paths still complete).
	 */
	complete(previousTokens: string[], token: string): ArgumentCandidate[] | null;
}

export interface ParsedCommandArguments {
	previousTokens: string[];
	token: string;
	tokenStart: number;
}

/** Case-insensitive subsequence test: "wt" matches "--with-tools". */
export function matchesLoosely(query: string, text: string): boolean {
	if (!query) return true;
	const haystack = text.toLowerCase();
	let index = 0;
	for (const char of query.toLowerCase()) {
		index = haystack.indexOf(char, index);
		if (index === -1) return false;
		index += 1;
	}
	return true;
}

/**
 * Returns the argument position under the cursor, or null when this is not an
 * argument of `command` — including the bare `/command` itself, which belongs to
 * pi's own command menu.
 */
export function parseCommandArguments(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	command: string,
): ParsedCommandArguments | null {
	const line = lines[cursorLine] ?? "";
	const beforeCursor = line.slice(0, cursorCol);
	const trimmed = beforeCursor.trimStart();

	const head = `/${command}`;
	if (!trimmed.startsWith(head)) return null;

	const rest = trimmed.slice(head.length);
	if (!/^\s/.test(rest)) return null;

	const token = /(\S*)$/.exec(beforeCursor)?.[1] ?? "";
	const previousTokens = rest
		.slice(0, rest.length - token.length)
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	return { previousTokens, token, tokenStart: beforeCursor.length - token.length };
}

function toItem(candidate: ArgumentCandidate): AutocompleteItem {
	return {
		value: candidate.value,
		label: candidate.value,
		...(candidate.description ? { description: candidate.description } : {}),
	};
}

/** Wraps a provider so `/command <args>` completes from `options.complete`. */
export function createCommandArgumentProvider(
	current: AutocompleteProvider,
	options: CommandArgumentOptions,
): AutocompleteProvider {
	const candidatesFor = (parsed: ParsedCommandArguments): ArgumentCandidate[] => {
		const candidates = options.complete(parsed.previousTokens, parsed.token);
		if (!candidates) return [];

		const token = parsed.token.toLowerCase();
		const matched = candidates.filter((candidate) => matchesLoosely(parsed.token, candidate.value));
		// A literal prefix is a stronger signal than a scattered subsequence, so
		// those come first; the declared order breaks every other tie.
		return matched
			.map((candidate, index) => ({ candidate, index, prefix: candidate.value.toLowerCase().startsWith(token) }))
			.sort((a, b) => (a.prefix === b.prefix ? a.index - b.index : a.prefix ? -1 : 1))
			.map((entry) => entry.candidate);
	};

	return {
		async getSuggestions(lines, cursorLine, cursorCol, opts): Promise<AutocompleteSuggestions | null> {
			const parsed = parseCommandArguments(lines, cursorLine, cursorCol, options.command);
			if (!parsed) return current.getSuggestions(lines, cursorLine, cursorCol, opts);

			const candidates = candidatesFor(parsed);
			if (candidates.length === 0) return current.getSuggestions(lines, cursorLine, cursorCol, opts);

			return { items: candidates.map(toItem), prefix: parsed.token };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const parsed = parseCommandArguments(lines, cursorLine, cursorCol, options.command);
			const isOurs =
				parsed !== null &&
				prefix === parsed.token &&
				candidatesFor(parsed).some((candidate) => candidate.value === item.value);

			if (!parsed || !isOurs) return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);

			const line = lines[cursorLine] ?? "";
			const newLines = [...lines];
			newLines[cursorLine] = `${line.slice(0, parsed.tokenStart)}${item.value} ${line.slice(cursorCol)}`;

			return { lines: newLines, cursorLine, cursorCol: parsed.tokenStart + item.value.length + 1 };
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}
