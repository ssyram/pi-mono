import type { AutocompleteItem, AutocompleteSuggestions } from "@earendil-works/pi-tui";

export interface AutocompleteEdit {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
}

export function normalizeAutocompleteSuggestions(value: unknown): AutocompleteSuggestions | null {
	try {
		if (!value || typeof value !== "object") return null;
		const record = value as Record<string, unknown>;
		const prefix = record.prefix;
		const rawItems = record.items;
		if (typeof prefix !== "string" || !Array.isArray(rawItems) || rawItems.length === 0) return null;
		const items: AutocompleteItem[] = [];
		// Copy by array index: a hostile custom Symbol.iterator must not shape the output.
		for (let index = 0; index < rawItems.length; index++) {
			const raw = rawItems[index];
			if (!raw || typeof raw !== "object") return null;
			const item = raw as Record<string, unknown>;
			const itemValue = item.value;
			const label = item.label;
			const description = item.description;
			if (typeof itemValue !== "string" || typeof label !== "string") return null;
			if (description !== undefined && typeof description !== "string") return null;
			items.push(description === undefined ? { value: itemValue, label } : { value: itemValue, label, description });
		}
		return { prefix, items };
	} catch {
		return null;
	}
}

export function normalizeAutocompleteEdit(value: unknown): AutocompleteEdit | null {
	try {
		if (!value || typeof value !== "object") return null;
		const record = value as Record<string, unknown>;
		const rawLines = record.lines;
		const cursorLine = record.cursorLine;
		const cursorCol = record.cursorCol;
		if (!Array.isArray(rawLines) || rawLines.length === 0) return null;
		if (typeof cursorLine !== "number" || !Number.isInteger(cursorLine)) return null;
		if (typeof cursorCol !== "number" || !Number.isInteger(cursorCol)) return null;
		const lines: string[] = [];
		for (const line of rawLines) {
			if (typeof line !== "string") return null;
			lines.push(line);
		}
		if (cursorLine < 0 || cursorLine >= lines.length || cursorCol < 0 || cursorCol > lines[cursorLine]!.length) {
			return null;
		}
		return { lines, cursorLine, cursorCol };
	} catch {
		return null;
	}
}
