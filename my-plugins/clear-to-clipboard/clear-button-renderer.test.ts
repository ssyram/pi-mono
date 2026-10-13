import type { ExtensionUIContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type Component, type EditorTheme, type TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import { describe, expect, it, vi } from "vitest";
import { CustomEditor } from "../../packages/coding-agent/src/modes/interactive/components/custom-editor.js";
import { WorkingStatusIndicator } from "../../packages/coding-agent/src/modes/interactive/components/status-indicator.js";
import { getThemeByName } from "../../packages/coding-agent/src/modes/interactive/theme/theme.js";
import { VirtualTerminal } from "../../packages/tui/test/virtual-terminal.js";

import { attachClearAction } from "./attach-clear-action.js";
import { attachClearButton } from "./attach-clear-button.js";

function setup() {
	const uiTheme = getThemeByName("dark");
	if (!uiTheme) throw new Error("Test theme missing");
	const terminal = new VirtualTerminal(80, 24);
	const tui = new TuiAltScreen(terminal);
	const keybindings = {
		matches: (data: string, action: string) => action === "app.clear" && data === "\x03",
	} as unknown as KeybindingsManager;
	const theme = { borderColor: (text: string) => uiTheme.fg("muted", text), selectList: {} } as EditorTheme;
	const editor = new CustomEditor(tui, theme, keybindings, { embedWorkingStatus: true });
	const working = new WorkingStatusIndicator(tui, "Working", { frames: ["*"] }, (text) => text);
	editor.setWorkingStatusIndicator(working);
	const original = vi.fn(() => editor.setText(""));
	editor.onAction("app.clear", original);
	editor.handleInput(`\x1b[200~${"甲".repeat(1001)}\x1b[201~`);
	tui.addChild(editor);
	tui.setFocus(editor);
	const copy = vi.fn(async (_text: string) => {});
	const notify = vi.fn();
	const { release, clearOnly } = attachClearAction(
		{
			notify,
			setWidget: (_key: string, factory?: (tui: TUI, theme: unknown) => Component) => factory?.(tui, {}),
			onTerminalInput: (handler: Parameters<ExtensionUIContext["onTerminalInput"]>[0]) =>
				tui.addInputListener(handler),
		} as Parameters<typeof attachClearAction>[0],
		copy,
	);
	let releaseButton: (() => void) | undefined;
	tui.start();
	return {
		terminal,
		tui,
		editor,
		original,
		copy,
		notify,
		clearOnly,
		attachButton: () => {
			releaseButton = attachClearButton(editor, tui, clearOnly, (text) =>
				uiTheme.bg("selectedBg", uiTheme.fg("text", text)),
			);
		},
		stop: () => {
			releaseButton?.();
			release();
			working.dispose();
			tui.stop();
		},
	};
}

describe("clear button native renderer", () => {
	it("leaves the button disconnected in the production clear action", async () => {
		const state = setup();
		try {
			await state.terminal.waitForRender();
			expect(state.terminal.getViewport().some((line) => line.includes("Clear"))).toBe(false);
			expect(Object.hasOwn(state.editor, "renderTopBorder")).toBe(false);
			expect(Object.hasOwn(state.editor, "handleMouse")).toBe(false);
			state.terminal.sendInput("\x1b[<0;75;1M");
			state.terminal.sendInput("\x1b[<0;75;1m");
			expect(state.original).not.toHaveBeenCalled();
			state.clearOnly();
			expect(state.editor.getExpandedText()).toBe("");
			expect(state.copy).not.toHaveBeenCalled();
			state.editor.setText("protected input");
			state.terminal.sendInput("\x03");
			expect(state.copy).toHaveBeenCalledExactlyOnceWith("protected input");
		} finally {
			state.stop();
		}
	});

	it("renders a background-colored button with right padding, follows resize, and clears without copying", async () => {
		const state = setup();
		state.attachButton();
		try {
			await state.terminal.waitForRender();
			let row = state.terminal.getViewport().find((line) => line.includes(" Clear"));
			expect(row).toContain("Working");
			expect(row?.indexOf("Clear")).toBe(71);
			const buttonRow = state.terminal.getViewport().findIndex((line) => line.includes(" Clear"));
			const xterm = Reflect.get(state.terminal, "xterm") as HeadlessTerminal;
			const buffer = xterm.buffer.active;
			const cells = buffer.getLine(buffer.viewportY + buttonRow);
			expect(cells?.getCell(71)?.isBgDefault()).toBe(false);
			expect(cells?.translateToString(false).slice(-3)).toBe("───");
			expect(cells?.getCell(79)?.isBgDefault()).toBe(true);
			expect(cells?.getCell(79)?.getFgColor()).toBe(cells?.getCell(60)?.getFgColor());
			state.terminal.resize(100, 24);
			await state.terminal.waitForRender();
			row = state.terminal.getViewport().find((line) => line.includes(" Clear"));
			expect(row).toContain("Working");
			expect(row?.indexOf("Clear")).toBe(91);
			state.terminal.resize(10, 24);
			await state.terminal.waitForRender();
			expect(state.terminal.getViewport().some((line) => line.includes(" Clear"))).toBe(false);
			state.terminal.resize(60, 24);
			await state.terminal.waitForRender();
			const y = state.terminal.getViewport().findIndex((line) => line.includes(" Clear")) + 1;
			expect(y).toBeGreaterThan(0);
			state.terminal.sendInput(`\x1b[<0;56;${y}M`);
			expect(state.original).not.toHaveBeenCalled();
			state.terminal.sendInput(`\x1b[<0;56;${y}m`);
			expect(state.original).toHaveBeenCalledTimes(1);
			expect(state.editor.getText()).toBe("");
			expect(state.editor.getExpandedText()).toBe("");
			expect(state.copy).not.toHaveBeenCalled();
			expect(state.notify).not.toHaveBeenCalled();
			state.editor.setText("protected input");
			state.terminal.sendInput("\x03");
			expect(state.copy).toHaveBeenCalledExactlyOnceWith("protected input");
		} finally {
			state.stop();
		}
	});

	it("does not clear on a drag or a click outside the button", async () => {
		const state = setup();
		state.attachButton();
		try {
			await state.terminal.waitForRender();
			const y = state.terminal.getViewport().findIndex((line) => line.includes(" Clear")) + 1;
			expect(y).toBeGreaterThan(0);
			state.terminal.sendInput(`\x1b[<0;75;${y}M`);
			state.terminal.sendInput(`\x1b[<32;74;${y}M`);
			state.terminal.sendInput(`\x1b[<0;74;${y}m`);
			state.terminal.sendInput(`\x1b[<0;20;${y}M`);
			state.terminal.sendInput(`\x1b[<0;20;${y}m`);
			state.terminal.sendInput(`\x1b[<0;79;${y}M`);
			state.terminal.sendInput(`\x1b[<0;79;${y}m`);
			expect(state.original).not.toHaveBeenCalled();
			expect(state.editor.getExpandedText()).toBe("甲".repeat(1001));
			expect(state.copy).not.toHaveBeenCalled();
		} finally {
			state.stop();
		}
	});
});
