import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { createLoopCommandAutocompleteProvider, type LoopCommandAutocompleteSource } from "../src/v2/loop-command-autocomplete.js";

describe("Loop 2.0 command autocomplete", () => {
	it("completes top-level commands and scope positions with loose matching", async () => {
		const provider = createLoopCommandAutocompleteProvider(fallback(), source());
		assert.deepEqual(await values(provider, "/loop "), ["add", "define", "available", "register", "unregister", "list", "stop", "delete", "run", "help"]);
		assert.deepEqual(await values(provider, "/loop d"), ["define", "delete", "add"]);
		assert.deepEqual(await values(provider, "/loop define "), ["workspace", "global"]);
		assert.deepEqual(await values(provider, "/loop register g"), ["global"]);
		assert.deepEqual(await values(provider, "/loop unregister "), ["registration:global:two"]);
		assert.deepEqual(await values(provider, "/loop run "), ["session:active", "registration:global:two"]);
	});

	it("uses dynamic ids for register, stop, and delete force paths", async () => {
		const provider = createLoopCommandAutocompleteProvider(fallback(), source());
		assert.deepEqual(await values(provider, "/loop register workspace "), ["workspace:one"]);
		assert.deepEqual(await values(provider, "/loop stop "), ["session:active", "registration:global:two"]);
		assert.deepEqual(await values(provider, "/loop delete "), ["--force", "workspace:one", "global:two"]);
		assert.deepEqual(await values(provider, "/loop delete --force "), ["workspace:one", "global:two"]);
	});

	it("claims forced Tab positions, applies candidates, and falls back when unsupported", async () => {
		const current = fallback();
		const provider = createLoopCommandAutocompleteProvider(current, source());
		assert.equal(provider.shouldTriggerFileCompletion?.(["/loop "], 0, 6), true);
		assert.equal(provider.shouldTriggerFileCompletion?.(["plain"], 0, 5), false);
		const applied = provider.applyCompletion(["/loop de"], 0, 8, { value: "delete", label: "delete" }, "de");
		assert.equal(applied.lines[0], "/loop delete ");
		assert.deepEqual(await values(provider, "/loop unknown "), ["fallback"]);
	});
});

function source(): LoopCommandAutocompleteSource {
	return { activeIds: () => ["session:active", "registration:global:two"], sharedDefinitionIds: (scopes) => scopes?.[0] === "workspace" ? ["workspace:one"] : scopes?.[0] === "global" ? ["global:two"] : ["workspace:one", "global:two"] };
}
function fallback(): AutocompleteProvider & { shouldTriggerFileCompletion?(lines: string[], row: number, col: number): boolean } {
	return {
		getSuggestions: async (): Promise<AutocompleteSuggestions> => ({ items: [{ value: "fallback", label: "fallback" }], prefix: "" }),
		applyCompletion: (lines, cursorLine, cursorCol, item: AutocompleteItem) => ({ lines: [...lines.slice(0, cursorLine), `${lines[cursorLine] ?? ""}${item.value}`, ...lines.slice(cursorLine + 1)], cursorLine, cursorCol: cursorCol + item.value.length }),
		shouldTriggerFileCompletion: () => false,
	};
}
async function values(provider: AutocompleteProvider, line: string): Promise<string[]> {
	const result = await provider.getSuggestions([line], 0, line.length, { signal: new AbortController().signal, force: true });
	return result?.items.map((item) => item.value) ?? [];
}
