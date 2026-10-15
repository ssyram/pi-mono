import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { normalizeAutocompleteEdit, normalizeAutocompleteSuggestions } from "./autocomplete-result.js";
import { loadExactReference, type ResourceReader } from "./exact-resource.js";
import { extractModifierContext } from "./modifier-context.js";
import { getModifierItems } from "./modifier-items.js";
import type { SkillRefEntry } from "./registry.js";

export function createModifierProvider(
	current: AutocompleteProvider,
	getEntries: () => SkillRefEntry[],
	read?: ResourceReader,
): AutocompleteProvider {
	let triggerCharacters = [":"];
	try {
		const existing = current.triggerCharacters;
		if (Array.isArray(existing)) {
			triggerCharacters = [
				...new Set([...existing.filter((value) => typeof value === "string" && value.length === 1), ":"]),
			];
		}
	} catch {
		triggerCharacters = [":"];
	}
	return {
		triggerCharacters,
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			try {
				if (options.signal.aborted) return null;
				const context = extractModifierContext(lines, cursorLine, cursorCol);
				if (!context || !loadExactReference(getEntries(), context.reference, read)) {
					return normalizeAutocompleteSuggestions(
						await current.getSuggestions([...lines], cursorLine, cursorCol, options),
					);
				}
				const items = getModifierItems(context);
				return items.length === 0 ? null : { items, prefix: context.prefix };
			} catch {
				return null;
			}
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const unchanged = { lines: [...lines], cursorLine, cursorCol };
			try {
				// Read item.value exactly once: a mutating getter must not desync the
				// candidate check, the inserted text, and the cursor math.
				const value = item.value;
				const context = extractModifierContext(lines, cursorLine, cursorCol);
				if (
					!context ||
					context.prefix !== prefix ||
					!loadExactReference(getEntries(), context.reference, read) ||
					!getModifierItems(context).some((candidate) => candidate.value === value)
				) {
					const downstream = current.applyCompletion([...lines], cursorLine, cursorCol, item, prefix) as unknown;
					// A synchronous delegate that wrongly returns a thenable leaves a
					// rejected promise nobody awaits; swallow that late rejection here.
					if (downstream && typeof (downstream as { then?: unknown }).then === "function") {
						void Promise.resolve(downstream).catch(() => {});
					}
					return normalizeAutocompleteEdit(downstream) ?? unchanged;
				}
				const line = lines[cursorLine]!;
				const newLines = [...lines];
				newLines[cursorLine] = `${line.slice(0, context.start)}${value} ${line.slice(cursorCol)}`;
				return {
					lines: newLines,
					cursorLine,
					cursorCol: context.start + value.length + 1,
				};
			} catch {
				return unchanged;
			}
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			try {
				const context = extractModifierContext(lines, cursorLine, cursorCol);
				if (context && loadExactReference(getEntries(), context.reference, read)) return true;
				const gate = current.shouldTriggerFileCompletion;
				if (gate === undefined) return true;
				if (typeof gate !== "function") return false;
				const result = gate.call(current, [...lines], cursorLine, cursorCol) as unknown;
				// Same containment as applyCompletion: a wrongly-async gate must not
				// leave an unhandled rejection in the host.
				if (result && typeof (result as { then?: unknown }).then === "function") {
					void Promise.resolve(result).catch(() => {});
				}
				return typeof result === "boolean" ? result : false;
			} catch {
				return false;
			}
		},
	};
}
