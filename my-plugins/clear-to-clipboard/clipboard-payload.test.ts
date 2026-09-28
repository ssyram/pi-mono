import { Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { formatClipboardPayload } from "./clipboard-payload.js";

describe("formatClipboardPayload", () => {
	it("keeps ordinary text, whitespace, and unmatched markers", () => {
		const raw = "  before\n[paste #9 1001 chars]\nafter  ";
		expect(formatClipboardPayload(raw, new Map([[1, "other"]]))).toBe(raw);
	});

	it("includes each native paste ID and its actual text", () => {
		const raw = "a [paste #1 1001 chars] b [paste #2 +12 lines] z";
		const pastes = new Map<number, string>([
			[1, "甲]乙\n丙"],
			[2, "first\nsecond"],
		]);
		expect(formatClipboardPayload(raw, pastes)).toBe("a [paste#1-- 甲]乙\n丙 ##] b [paste#2-- first\nsecond ##] z");
	});

	it("does not invent a body when the ID has no string value", () => {
		expect(formatClipboardPayload("[paste #1]", new Map<number, unknown>([[1, undefined]]))).toBe("[paste #1]");
	});

	it("uses the actual paste map retained by the pi-tui editor", () => {
		const tui = { requestRender: () => {}, terminal: { rows: 24 } } as unknown as TUI;
		const theme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
		const editor = new Editor(tui, theme);
		const content = "甲".repeat(1001);
		editor.handleInput(`\x1b[200~${content}\x1b[201~`);
		const pastes: unknown = (editor as unknown as Record<string, unknown>).pastes;
		expect(pastes).toBeInstanceOf(Map);
		if (!(pastes instanceof Map)) return;
		expect(formatClipboardPayload(editor.getText(), pastes)).toBe(`[paste#1-- ${content} ##]`);
	});
});
