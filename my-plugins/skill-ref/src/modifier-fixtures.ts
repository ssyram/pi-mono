import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { SkillRefEntry } from "./registry.js";

export const MODIFIER_TEST_ENTRIES: SkillRefEntry[] = [
	{
		kind: "skill",
		name: "alpha",
		qualifiedName: "skill:alpha",
		description: "",
		path: "/s/alpha/SKILL.md",
	},
];

export function createModifierTestDelegate(): AutocompleteProvider {
	return {
		triggerCharacters: ["#"],
		async getSuggestions() {
			return null;
		},
		applyCompletion(lines, cursorLine, cursorCol) {
			return { lines, cursorLine, cursorCol };
		},
		shouldTriggerFileCompletion() {
			return false;
		},
	};
}
