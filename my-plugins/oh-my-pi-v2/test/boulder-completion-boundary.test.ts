import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { createHumanTaskCompletionProvider } from "../tools/task-system/human-completion.js";

const options = { signal: new AbortController().signal, force: true };
function fallback(): AutocompleteProvider {
	return { getSuggestions: async () => null, applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }) };
}

test("Boulder completion agrees with command keywords and keeps arbitrary source types", async () => {
	const provider = createHumanTaskCompletionProvider(fallback(), () => []);
	for (const [text, expected] of [
		["/task bo", ["boulder"]],
		["/task boulder ", ["set"]],
		["/task BOULDER SET ", ["loop", "user"]],
		["/task boulder set custom-source ", ["true", "false", "t", "f"]],
	] as const) {
		const result = await provider.getSuggestions([text], 0, text.length, options);
		assert.deepEqual(result?.items.map((item) => item.value), expected);
	}
	for (const text of ["/task 'boulder' ", "/task boulder 'set' "]) {
		assert.equal(await provider.getSuggestions([text], 0, text.length, options), null);
	}
});

test("completion catches async delegate rejection and recovers for the next request", async () => {
	const provider = createHumanTaskCompletionProvider({
		getSuggestions: async () => { throw new Error("delegate rejection"); },
		applyCompletion() { throw new Error("delegate apply failure"); },
	}, () => { throw new Error("task reader failure"); });
	assert.equal(await provider.getSuggestions(["plain"], 0, 5, options), null);
	const text = "/task boulder set loop tr";
	assert.deepEqual((await provider.getSuggestions([text], 0, text.length, options))?.items.map((item) => item.value), ["true"]);
	assert.deepEqual(provider.applyCompletion(["plain"], 0, 5, { value: "x", label: "x" }, ""), { lines: ["plain"], cursorLine: 0, cursorCol: 5 });
});
