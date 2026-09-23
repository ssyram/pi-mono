import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { UsageModel, UsageModelRegistry } from "./usage-contract.js";

const command = "/provider-usage";

interface TabAutocompleteProvider extends AutocompleteProvider {
	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}

function matches(query: string, name: string): boolean {
	let offset = 0;
	for (const letter of query.toLowerCase()) {
		const next = name.toLowerCase().indexOf(letter, offset);
		if (next < 0) return false;
		offset = next + 1;
	}
	return true;
}

export function providerCandidates(
	argumentPrefix: string,
	registry: Pick<UsageModelRegistry, "getAll">,
	current: UsageModel | undefined,
): { previous: string; token: string; candidates: string[] } {
	const token = /(\S*)$/.exec(argumentPrefix)?.[1] ?? "";
	const previous = argumentPrefix.slice(0, argumentPrefix.length - token.length);
	const selected = previous.trim().split(/\s+/).filter(Boolean);
	if (selected.includes("--all")) return { previous, token, candidates: [] };
	const names = new Set(registry.getAll().map((model) => model.provider));
	if (current && !(current.provider === "unknown" && current.id === "unknown" && current.api === "unknown")) {
		names.add(current.provider);
	}
	const candidates = [...names].filter((name) => !selected.includes(name) && matches(token, name));
	if (selected.length === 0 && matches(token, "--all")) candidates.unshift("--all");
	return { previous, token, candidates };
}

export function completeProviderUsageArgs(
	argumentPrefix: string,
	registry: Pick<UsageModelRegistry, "getAll">,
	current: UsageModel | undefined,
): AutocompleteItem[] | null {
	const { previous, candidates } = providerCandidates(argumentPrefix, registry, current);
	return candidates.length > 0 ? candidates.map((name) => ({ value: `${previous}${name}`, label: name })) : null;
}

function atArgument(lines: string[], cursorLine: number, cursorCol: number): { prefix: string; token: string; start: number } | undefined {
	const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
	const trimmed = beforeCursor.trimStart();
	if (!trimmed.startsWith(command) || !/^\s/.test(trimmed.slice(command.length))) return undefined;
	const prefix = trimmed.slice(command.length);
	const token = /(\S*)$/.exec(prefix)?.[1] ?? "";
	return { prefix, token, start: cursorCol - token.length };
}

export function createProviderUsageCompletion(
	current: AutocompleteProvider,
	getOptions: () => { registry: Pick<UsageModelRegistry, "getAll">; model: UsageModel | undefined },
): AutocompleteProvider {
	const delegate = current as TabAutocompleteProvider;
	const wrapper: TabAutocompleteProvider = {
		async getSuggestions(lines, cursorLine, cursorCol, opts) {
			const argument = atArgument(lines, cursorLine, cursorCol);
			if (!argument) return current.getSuggestions(lines, cursorLine, cursorCol, opts);
			const { registry, model } = getOptions();
			const { candidates } = providerCandidates(argument.prefix, registry, model);
			return candidates.length > 0
				? { items: candidates.map((name) => ({ value: name, label: name })), prefix: argument.token }
				: current.getSuggestions(lines, cursorLine, cursorCol, opts);
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const argument = atArgument(lines, cursorLine, cursorCol);
			if (!argument || prefix !== argument.token) return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			const { registry, model } = getOptions();
			if (!providerCandidates(argument.prefix, registry, model).candidates.includes(item.value)) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const updated = [...lines];
			const line = updated[cursorLine] ?? "";
			updated[cursorLine] = `${line.slice(0, argument.start)}${item.value} ${line.slice(cursorCol)}`;
			return { lines: updated, cursorLine, cursorCol: argument.start + item.value.length + 1 };
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return atArgument(lines, cursorLine, cursorCol) ? true : delegate.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
	return wrapper;
}
