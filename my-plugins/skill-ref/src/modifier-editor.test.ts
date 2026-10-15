import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { createModifierProvider } from "./modifier-autocomplete.js";
import { createModifierTestDelegate, MODIFIER_TEST_ENTRIES } from "./modifier-fixtures.js";
import { transformReferences } from "./transform-references.js";

const theme: EditorTheme = {
	borderColor: (text) => text,
	selectList: {
		selectedPrefix: (text) => text,
		selectedText: (text) => text,
		description: (text) => text,
		scrollInfo: (text) => text,
		noMatch: (text) => text,
	},
};

describe("modifier automatic triggering in real Editor", () => {
	it("opens on a spaced colon without Tab and applies a legal command", async () => {
		const tui = {
			requestRender() {},
			terminal: { rows: 24 },
		} as unknown as TUI;
		const editor = new Editor(tui, theme);
		editor.setAutocompleteProvider(
			createModifierProvider(
				createModifierTestDelegate(),
				() => MODIFIER_TEST_ENTRIES,
				() => "body",
			),
		);
		editor.setText("use /alpha ");
		editor.handleInput(":");
		await setTimeout(60);
		assert.equal(editor.isShowingAutocomplete(), true);
		assert.equal(editor.getText(), "use /alpha :");
		editor.handleInput("\r");
		assert.equal(editor.getText(), "use /alpha :print ");
		assert.deepEqual(editor.getCursor(), { line: 0, col: 18 });
	});

	it("does not open a modifier menu for standalone, ordinary or unresolved colons", async () => {
		for (const prefix of ["", "ordinary ", "/missing "]) {
			const tui = {
				requestRender() {},
				terminal: { rows: 24 },
			} as unknown as TUI;
			const editor = new Editor(tui, theme);
			editor.setAutocompleteProvider(
				createModifierProvider(
					createModifierTestDelegate(),
					() => MODIFIER_TEST_ENTRIES,
					() => "body",
				),
			);
			editor.setText(prefix);
			editor.handleInput(":");
			await setTimeout(60);
			assert.equal(editor.isShowingAutocomplete(), false, prefix);
		}
	});

	it("selects the bare escape option and sends a literal colon", async () => {
		const tui = { requestRender() {}, terminal: { rows: 24 } } as unknown as TUI;
		const editor = new Editor(tui, theme);
		editor.setAutocompleteProvider(
			createModifierProvider(
				createModifierTestDelegate(),
				() => MODIFIER_TEST_ENTRIES,
				() => "body",
			),
		);
		editor.setText("use /alpha ");
		editor.handleInput(":");
		await setTimeout(60);
		assert.equal(editor.isShowingAutocomplete(), true);
		editor.handleInput("\x1b[B");
		editor.handleInput("\x1b[B");
		editor.handleInput("\r");
		assert.equal(editor.getText(), "use /alpha \\: ");
		assert.equal(
			transformReferences(editor.getText(), MODIFIER_TEST_ENTRIES, () => {
				throw new Error("literal must not load");
			}),
			"use /alpha : ",
		);
	});
});
