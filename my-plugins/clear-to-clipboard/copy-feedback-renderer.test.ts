import type { ExtensionUIContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type Component, type EditorTheme, type TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { CustomEditor } from "../../packages/coding-agent/src/modes/interactive/components/custom-editor.js";
import { VirtualTerminal } from "../../packages/tui/test/virtual-terminal.js";

import { attachClearAction } from "./attach-clear-action.js";

describe("native copy feedback renderer", () => {
	it.each([true, false])("renders clear feedback at the top right when copied=%s", async (copied) => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TuiAltScreen(terminal);
		const keybindings = {
			matches: (data: string, action: string) => action === "app.clear" && data === "\x03",
		} as unknown as KeybindingsManager;
		const theme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
		const editor = new CustomEditor(tui, theme, keybindings);
		const original = vi.fn(() => editor.setText(""));
		editor.onAction("app.clear", original);
		editor.setText("test input");
		const notify = vi.fn();
		const copy = vi.fn(async (_text: string) => {
			if (!copied) throw new Error("clipboard unavailable");
		});
		const ui = {
			notify,
			setWidget: (_: string, factory?: (tui: TUI, theme: unknown) => Component) => {
				if (factory) factory(tui, {});
			},
			onTerminalInput: (handler: Parameters<ExtensionUIContext["onTerminalInput"]>[0]) =>
				tui.addInputListener(handler),
		} as Parameters<typeof attachClearAction>[0];
		const release = attachClearAction(ui, copy);
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		try {
			terminal.sendInput("\x03");
			expect(editor.getText()).toBe("");
			expect(original).toHaveBeenCalledTimes(1);
			expect(copy).toHaveBeenCalledExactlyOnceWith("test input");
			await terminal.waitForRender();
			const message = copied ? "Copied cleared input" : "Copy failed (input cleared)";
			const firstRow = terminal.getViewport()[0];
			expect(firstRow?.slice(80 - message.length - 1, 79)).toBe(message);
			expect(firstRow?.indexOf(message)).toBe(80 - message.length - 1);
			expect(notify).not.toHaveBeenCalled();
		} finally {
			release();
			tui.stop();
		}
	});
});
