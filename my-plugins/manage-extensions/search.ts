import type { ExtensionState } from "./resolve-state.js";

export function searchableText(state: ExtensionState): string {
	return normalizeSearch(`${state.extension.repoName}/${state.extension.name}`);
}

export function normalizeSearch(value: string): string {
	return value.toLowerCase();
}

export function matchesSearch(query: string, text: string): boolean {
	let index = 0;
	for (const char of query) {
		index = text.indexOf(char, index);
		if (index === -1) return false;
		index += 1;
	}
	return true;
}
