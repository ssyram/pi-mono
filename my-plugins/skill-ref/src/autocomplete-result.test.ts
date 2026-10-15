import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAutocompleteEdit, normalizeAutocompleteSuggestions } from "./autocomplete-result.js";

describe("autocomplete return contracts", () => {
	it("snapshots legal suggestions and omits absent optional fields", () => {
		const original = {
			prefix: ":",
			items: [{ value: ":print", label: "print", description: undefined }],
		};
		const normalized = normalizeAutocompleteSuggestions(original)!;
		assert.deepEqual(normalized, {
			prefix: ":",
			items: [{ value: ":print", label: "print" }],
		});
		original.items[0]!.value = "changed";
		assert.equal(normalized.items[0]!.value, ":print");
		assert.deepEqual(
			normalizeAutocompleteSuggestions({
				prefix: ":",
				items: [{ value: "x", label: "y", description: "z" }],
			}),
			{ prefix: ":", items: [{ value: "x", label: "y", description: "z" }] },
		);
	});

	it("copies by array index, ignoring a hostile custom iterator", () => {
		const items: unknown[] = [{ value: ":print", label: ":print" }];
		Object.defineProperty(items, Symbol.iterator, {
			value: function* () {},
		});
		assert.deepEqual(normalizeAutocompleteSuggestions({ prefix: ":", items }), {
			prefix: ":",
			items: [{ value: ":print", label: ":print" }],
		});
	});

	it("rejects undefined, malformed suggestions, sparse arrays and throwing getters", () => {
		const values: unknown[] = [
			undefined,
			null,
			{},
			{ prefix: 1, items: [] },
			{ prefix: ":", items: [] },
			{ prefix: ":", items: [undefined] },
			{ prefix: ":", items: new Array(1) },
			{ prefix: ":", items: [{ value: "x" }] },
			{ prefix: ":", items: [{ value: "x", label: "y", description: 1 }] },
			{
				get prefix() {
					throw new Error("getter");
				},
			},
			{
				prefix: ":",
				items: [
					{
						get value() {
							throw new Error("item getter");
						},
					},
				],
			},
		];
		for (const value of values) assert.equal(normalizeAutocompleteSuggestions(value), null);
	});

	it("snapshots valid edits and rejects illegal text or cursor positions", () => {
		const input = { lines: ["hello"], cursorLine: 0, cursorCol: 5 };
		const output = normalizeAutocompleteEdit(input)!;
		input.lines[0] = "changed";
		assert.deepEqual(output, { lines: ["hello"], cursorLine: 0, cursorCol: 5 });
		const values: unknown[] = [
			undefined,
			{},
			{ ...input, lines: [] },
			{ ...input, lines: [1] },
			{ ...input, lines: new Array(1) },
			{ ...input, cursorLine: -1 },
			{ ...input, cursorLine: 1 },
			{ ...input, cursorCol: -1 },
			{ ...input, cursorCol: 100 },
			{ ...input, cursorCol: 0.5 },
			{ ...input, cursorCol: Number.NaN },
			{
				get lines() {
					throw new Error("getter");
				},
			},
		];
		for (const value of values) assert.equal(normalizeAutocompleteEdit(value), null);
	});
});
