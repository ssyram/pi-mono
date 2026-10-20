import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLoopV2Command } from "../src/v2/parse-v2-command.js";
import { createLoopCommandAutocompleteProvider } from "../src/v2/loop-command-autocomplete.js";

const options = { signal: new AbortController().signal, force: true };
test("flag parsing preserves literal prompt text and at separator", () => {
	for (const input of ["add --no-boulder 1h hello", "add 1h --no-boulder hello", "add once --no-boulder 1m hello"]) {
		const result = parseLoopV2Command(input, 1_700_000_000_000);
		assert.equal(result.kind, "add");
		if (result.kind !== "add") assert.fail("expected add");
		assert.equal(result.inhibitBoulder, true);
		assert.equal(result.prompt, "hello");
	}
	for (const input of ["add 1h say --no-boulder literally", "add at 2099-01-01T00:00:00Z -- --no-boulder literal"]) {
		const result = parseLoopV2Command(input);
		if (result.kind !== "add") assert.fail("expected add");
		assert.equal(result.inhibitBoulder, undefined);
		assert.ok(result.prompt !== undefined);
		assert.match(result.prompt, /--no-boulder/);
	}
});

test("Tab offers the flag only in add/define option positions, including ws alias", async () => {
	const provider = createLoopCommandAutocompleteProvider({
		getSuggestions: async () => null,
		applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
	}, { activeIds: () => [], sharedDefinitionIds: () => [] });
	for (const text of ["/loop add ", "/loop add 1h ", "/loop add once ", "/loop define ws "]) {
		assert.deepEqual((await provider.getSuggestions([text], 0, text.length, options))?.items.map((item) => item.value),
			text === "/loop add " || text === "/loop define ws " ? ["--no-boulder", "--script", "--wake"] : ["--no-boulder"]);
	}
	for (const text of ["/loop available workspace ", "/loop add 1h prompt ", "/loop add --no-boulder 1h ", "/loop add at tomorrow -- "]) {
		assert.equal(await provider.getSuggestions([text], 0, text.length, options), null);
	}
});
