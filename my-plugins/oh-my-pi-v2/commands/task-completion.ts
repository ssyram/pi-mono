import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";

export interface TaskArgumentCandidate {
	value: string;
	description: string;
}

interface ParsedTaskArguments {
	previousTokens: string[];
	token: string;
	tokenStart: number;
}

export interface TaskAutocompleteProvider extends AutocompleteProvider {
	shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean;
}

const ROOT_CANDIDATES: TaskArgumentCandidate[] = [
	{ value: "show", description: "Control task widget visibility" },
	{ value: "info", description: "Print complete task details" },
	{ value: "help", description: "Show task command help" },
];

const SHOW_CANDIDATES: TaskArgumentCandidate[] = [
	{ value: "on", description: "Show the task widget" },
	{ value: "off", description: "Hide the task widget" },
];

export function completeTaskArgument(previousTokens: string[]): TaskArgumentCandidate[] | null {
	if (previousTokens.length === 0) return ROOT_CANDIDATES;
	if (previousTokens.length === 1 && previousTokens[0]?.toLowerCase() === "show") return SHOW_CANDIDATES;
	return null;
}

function parseTaskArguments(lines: string[], cursorLine: number, cursorCol: number): ParsedTaskArguments | null {
	const line = lines[cursorLine] ?? "";
	const beforeCursor = line.slice(0, cursorCol);
	const trimmed = beforeCursor.trimStart();
	const head = "/task";
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

function matchesLoosely(query: string, text: string): boolean {
	if (!query) return true;
	const haystack = text.toLowerCase();
	let index = 0;
	for (const character of query.toLowerCase()) {
		index = haystack.indexOf(character, index);
		if (index === -1) return false;
		index += 1;
	}
	return true;
}

function candidatesFor(parsed: ParsedTaskArguments): TaskArgumentCandidate[] {
	const candidates = completeTaskArgument(parsed.previousTokens) ?? [];
	const token = parsed.token.toLowerCase();
	return candidates
		.filter((candidate) => matchesLoosely(parsed.token, candidate.value))
		.map((candidate, index) => ({ candidate, index, prefix: candidate.value.toLowerCase().startsWith(token) }))
		.sort((left, right) =>
			left.prefix === right.prefix ? left.index - right.index : left.prefix ? -1 : 1,
		)
		.map((entry) => entry.candidate);
}

function toItem(candidate: TaskArgumentCandidate): AutocompleteItem {
	return { value: candidate.value, label: candidate.value, description: candidate.description };
}

export function createTaskCompletionProvider(current: AutocompleteProvider): TaskAutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const parsed = parseTaskArguments(lines, cursorLine, cursorCol);
			if (!parsed) return current.getSuggestions(lines, cursorLine, cursorCol, options);
			const candidates = candidatesFor(parsed);
			if (candidates.length === 0) return current.getSuggestions(lines, cursorLine, cursorCol, options);
			return { items: candidates.map(toItem), prefix: parsed.token };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const parsed = parseTaskArguments(lines, cursorLine, cursorCol);
			const isOurs =
				parsed !== null &&
				prefix === parsed.token &&
				candidatesFor(parsed).some((candidate) => candidate.value === item.value);
			if (!parsed || !isOurs) return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);

			const line = lines[cursorLine] ?? "";
			const nextLines = [...lines];
			nextLines[cursorLine] = `${line.slice(0, parsed.tokenStart)}${item.value} ${line.slice(cursorCol)}`;
			return { lines: nextLines, cursorLine, cursorCol: parsed.tokenStart + item.value.length + 1 };
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			if (parseTaskArguments(lines, cursorLine, cursorCol)) return true;
			const fallback = current as AutocompleteProvider & Partial<TaskAutocompleteProvider>;
			return fallback.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}
