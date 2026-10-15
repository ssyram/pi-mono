import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { type ModifierContext, REFERENCE_OPERATIONS } from "./reference-modifier.js";

export function getModifierItems(context: ModifierContext): AutocompleteItem[] {
	// An escaped context is terminal: free literal text follows, no menu.
	if (context.escaped) return [];
	const items: AutocompleteItem[] = REFERENCE_OPERATIONS.map((operation) => ({
		value: `${context.separator}${operation}`,
		label: `${context.separator}${operation}`,
		description: operation === "print" ? "append full text" : "absolute file path",
	}));
	items.push({
		value: `\\${context.separator}`,
		label: `\\${context.separator}`,
		description: "literal, no expansion",
	});
	// The escape item cannot be typed toward (a backslash ends the context),
	// so it is only offered alongside the unfiltered menu.
	return context.fragment === "" ? items : items.filter((item) => item.value.startsWith(context.prefix));
}
