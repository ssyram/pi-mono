import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModifierProvider } from "./modifier-autocomplete.js";
import { createModifierTestDelegate, MODIFIER_TEST_ENTRIES } from "./modifier-fixtures.js";

const getEntries = () => MODIFIER_TEST_ENTRIES;
const read = () => "body";
const options = { signal: new AbortController().signal, force: false };

describe("modifier provider", () => {
	it("merges trigger characters and offers commands on non-forced requests", async () => {
		const provider = createModifierProvider(createModifierTestDelegate(), getEntries, read);
		assert.deepEqual(provider.triggerCharacters, ["#", ":"]);
		const text = "use /alpha :";
		const result = await provider.getSuggestions([text], 0, text.length, options);
		assert.equal(result?.prefix, ":");
		assert.deepEqual(
			result?.items.map((item) => item.value),
			[":print", ":path", "\\:"],
		);
		assert.equal(result?.items[2]?.description, "literal, no expansion");
	});

	it("filters fragments and closes the menu on escaped prefixes", async () => {
		const provider = createModifierProvider(createModifierTestDelegate(), getEntries, read);
		for (const [suffix, expected] of [
			[":pr", [":print"]],
			[":pa", [":path"]],
			["::pa", ["::path"]],
		] as const) {
			const text = `use /alpha ${suffix}`;
			assert.deepEqual(
				(await provider.getSuggestions([text], 0, text.length, options))?.items.map((item) => item.value),
				expected,
			);
		}
		const text = "use /alpha :xyz";
		assert.equal(await provider.getSuggestions([text], 0, text.length, options), null);
		const escaped = "use /alpha \\:pr";
		assert.equal(await provider.getSuggestions([escaped], 0, escaped.length, options), null);
	});

	it("delegates ordinary colons, incomplete names and ambiguous resources", async () => {
		let calls = 0;
		const current = createModifierTestDelegate();
		current.getSuggestions = async () => {
			calls++;
			return { prefix: "@", items: [{ value: "file", label: "file" }] };
		};
		const ambiguous = {
			...MODIFIER_TEST_ENTRIES[0]!,
			kind: "prompt" as const,
			qualifiedName: "prompt:alpha",
		};
		const provider = createModifierProvider(current, () => [...getEntries(), ambiguous], read);
		for (const text of [":", "hello :", "/missing :", "/Alpha :", "/alpha :", "/al :", "/skill:"]) {
			assert.equal((await provider.getSuggestions([text], 0, text.length, options))?.prefix, "@");
		}
		assert.equal(calls, 7);
		const qualified = "use /skill:alpha :";
		assert.equal((await provider.getSuggestions([qualified], 0, qualified.length, options))?.prefix, ":");
	});

	it("replaces only the operation prefix and preserves text right of the cursor", () => {
		const provider = createModifierProvider(createModifierTestDelegate(), getEntries, read);
		for (const [text, cursor, prefix, value, expected, expectedCursor] of [
			["use /alpha :pr rest", 14, ":pr", ":print", "use /alpha :print  rest", 18],
			["use /alpha :", 12, ":", "\\:", "use /alpha \\: ", 14],
		] as const) {
			const lines = [text];
			const result = provider.applyCompletion(lines, 0, cursor, { value, label: value }, prefix);
			assert.deepEqual(result.lines, [expected]);
			assert.deepEqual(lines, [text]);
			assert.equal(result.cursorCol, expectedCursor);
		}
	});

	it("reads item.value once so a mutating getter cannot desync the edit", () => {
		const provider = createModifierProvider(createModifierTestDelegate(), getEntries, read);
		let reads = 0;
		const item = {
			label: "print",
			get value(): string {
				reads += 1;
				return reads < 3 ? ":print" : `:${"x".repeat(64)}`;
			},
		};
		const result = provider.applyCompletion(["use /alpha :"], 0, 12, item, ":");
		assert.equal(reads, 1);
		assert.deepEqual(result.lines, ["use /alpha :print "]);
		assert.ok(result.cursorCol <= result.lines[0]!.length);
	});

	it("offers no modifier menu when the reference leads the first meaningful line", async () => {
		const provider = createModifierProvider(createModifierTestDelegate(), getEntries, read);
		for (const lines of [["/alpha :"], ["", "  /alpha :"], ["\t/alpha :pa"]]) {
			const cursorLine = lines.length - 1;
			const cursorCol = lines[cursorLine]!.length;
			assert.equal(await provider.getSuggestions(lines, cursorLine, cursorCol, options), null);
		}
		const menu = await provider.getSuggestions(["x /alpha :"], 0, 10, options);
		assert.equal(menu?.prefix, ":");
	});

	it("delegates stale prefixes, foreign candidates and changed resources", () => {
		let calls = 0;
		const current = createModifierTestDelegate();
		current.applyCompletion = (lines, cursorLine, cursorCol) => {
			calls++;
			return { lines, cursorLine, cursorCol };
		};
		const provider = createModifierProvider(current, getEntries, read);
		const text = "use /alpha :";
		provider.applyCompletion([text], 0, text.length, { value: ":print", label: "print" }, ":p");
		provider.applyCompletion([text], 0, text.length, { value: ":foreign", label: "foreign" }, ":");
		const missing = createModifierProvider(current, () => [], read);
		missing.applyCompletion([text], 0, text.length, { value: ":print", label: "print" }, ":");
		assert.equal(calls, 3);
	});

	it("respects aborted requests and claims only exact resource gates", async () => {
		const provider = createModifierProvider(createModifierTestDelegate(), getEntries, read);
		const text = "use /alpha :";
		assert.equal(
			await provider.getSuggestions([text], 0, text.length, {
				signal: AbortSignal.abort(),
			}),
			null,
		);
		assert.equal(provider.shouldTriggerFileCompletion?.([text], 0, text.length), true);
		assert.equal(provider.shouldTriggerFileCompletion?.(["hello :"], 0, 7), false);
	});
});
