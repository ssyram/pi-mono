import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import type { SharedScope } from "./model.js";

export type LoopCommandAutocompleteSource = {
	activeIds(): readonly string[];
	sharedDefinitionIds(scopes?: readonly SharedScope[]): readonly string[];
};
type Candidate = { value: string; description?: string };
type Parsed = { previous: string[]; token: string; start: number };
type TabAutocompleteProvider = AutocompleteProvider & {
	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
};

/** Future `/loop` adapter wraps Pi's existing provider with Loop 2.0 arguments. */
export function createLoopCommandAutocompleteProvider(current: AutocompleteProvider, source: LoopCommandAutocompleteSource): TabAutocompleteProvider {
	const candidates = (parsed: Parsed): Candidate[] => {
		const first = parsed.previous[0];
		if (parsed.previous.length === 0) return topLevel();
		if (first === "define" || first === "available") return parsed.previous.length === 1 ? scopes() : [];
		if (first === "register") return registerCandidates(parsed.previous, source);
		if (first === "unregister") return parsed.previous.length === 1 ? registrationIds(source.activeIds()) : [];
		if (first === "stop" || first === "run") return parsed.previous.length === 1 ? ids(source.activeIds(), "active task") : [];
		if (first === "delete") return deleteCandidates(parsed.previous, source);
		return [];
	};
	const filtered = (parsed: Parsed): Candidate[] => rank(candidates(parsed), parsed.token);
	const tabCurrent = current as TabAutocompleteProvider;
	return {
		async getSuggestions(lines: string[], row: number, col: number, opts: { signal: AbortSignal; force?: boolean }): Promise<AutocompleteSuggestions | null> {
			const parsed = parse(lines, row, col);
			if (parsed === undefined) return current.getSuggestions(lines, row, col, opts);
			const values = filtered(parsed);
			return values.length === 0 ? current.getSuggestions(lines, row, col, opts) : { items: values.map(item), prefix: parsed.token };
		},
		applyCompletion(lines: string[], row: number, col: number, choice: AutocompleteItem, prefix: string) {
			const parsed = parse(lines, row, col);
			if (parsed === undefined || prefix !== parsed.token || !filtered(parsed).some((candidate) => candidate.value === choice.value)) return current.applyCompletion(lines, row, col, choice, prefix);
			const next = [...lines]; const line = lines[row] ?? "";
			next[row] = `${line.slice(0, parsed.start)}${choice.value} ${line.slice(col)}`;
			return { lines: next, cursorLine: row, cursorCol: parsed.start + choice.value.length + 1 };
		},
		shouldTriggerFileCompletion(lines: string[], row: number, col: number) { return parse(lines, row, col) !== undefined || (tabCurrent.shouldTriggerFileCompletion?.(lines, row, col) ?? true); },
	};
}

function topLevel(): Candidate[] { return ["add", "define", "available", "register", "unregister", "list", "stop", "delete", "run", "help"].map((value) => ({ value })); }
function scopes(): Candidate[] { return [{ value: "workspace" }, { value: "global" }]; }
function ids(values: readonly string[], description: string): Candidate[] { return values.map((value) => ({ value, description })); }
function registrationIds(values: readonly string[]): Candidate[] { return values.filter((value) => value.startsWith("registration:")).map((value) => ({ value, description: "active registration" })); }
function registerCandidates(previous: string[], source: LoopCommandAutocompleteSource): Candidate[] {
	if (previous.length === 1) return scopes();
	const scope = previous[1];
	if (previous.length === 2 && scope !== undefined && isScope(scope)) return ids(source.sharedDefinitionIds([scope]), "shared definition");
	return [];
}
function deleteCandidates(previous: string[], source: LoopCommandAutocompleteSource): Candidate[] {
	if (previous.length === 1) return [{ value: "--force", description: "remove every registration" }, ...ids(source.sharedDefinitionIds(), "shared definition")];
	if (previous.length === 2 && previous[1] === "--force") return ids(source.sharedDefinitionIds(), "shared definition");
	return [];
}
function parse(lines: string[], row: number, col: number): Parsed | undefined {
	const before = (lines[row] ?? "").slice(0, col); const trimmed = before.trimStart();
	if (!trimmed.startsWith("/loop")) return undefined;
	const rest = trimmed.slice(5); if (!/^\s/.test(rest)) return undefined;
	const token = /(\S*)$/.exec(before)?.[1] ?? "";
	return { previous: rest.slice(0, rest.length - token.length).trim().split(/\s+/).filter(Boolean), token, start: before.length - token.length };
}
function rank(candidates: Candidate[], query: string): Candidate[] {
	const lower = query.toLowerCase();
	return candidates.filter((candidate) => loose(lower, candidate.value)).sort((a, b) => Number(b.value.toLowerCase().startsWith(lower)) - Number(a.value.toLowerCase().startsWith(lower)));
}
function loose(query: string, value: string): boolean { let at = 0; for (const char of query) { at = value.toLowerCase().indexOf(char, at); if (at === -1) return false; at += 1; } return true; }
function item(candidate: Candidate): AutocompleteItem { return candidate.description === undefined ? { value: candidate.value, label: candidate.value } : { value: candidate.value, label: candidate.value, description: candidate.description }; }
function isScope(value: string): value is SharedScope { return value === "workspace" || value === "global"; }
