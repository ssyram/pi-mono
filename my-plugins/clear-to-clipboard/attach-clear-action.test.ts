import type { ExtensionUIContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { CustomEditor } from "../../packages/coding-agent/src/modes/interactive/components/custom-editor.js";

import { attachClearAction } from "./attach-clear-action.js";

type Listener = Parameters<ExtensionUIContext["onTerminalInput"]>[0];

type FakeEditor = Component & {
	actionHandlers: Map<string, () => void>;
	getText(): string;
	getExpandedText(): string;
	pastes: Map<number, string>;
};

function setup(rawText: string, fullText = rawText, pastes = new Map<number, string>()) {
	let raw = rawText;
	let focused: Component | null = null;
	let listener: Listener | undefined;
	const calls: string[] = [];
	const original = vi.fn(() => {
		calls.push("clear");
		raw = "";
	});
	const editor: FakeEditor = {
		render: () => [],
		invalidate: () => {},
		actionHandlers: new Map([["app.clear", original]]),
		getText: () => raw,
		getExpandedText: () => fullText,
		pastes,
	};
	focused = editor;
	const tui = { getFocusedComponent: () => focused } as unknown as TUI;
	const unsubscribe = vi.fn();
	const setWidget = vi.fn((_: string, factory?: (tui: TUI, theme: unknown) => Component) => {
		if (factory) factory(tui, {});
	});
	const ui = {
		setWidget,
		onTerminalInput: (handler: Listener) => {
			listener = handler;
			return unsubscribe;
		},
	} as Parameters<typeof attachClearAction>[0];
	const copy = vi.fn(async (text: string) => {
		calls.push(`copy:${text}`);
	});
	const release = attachClearAction(ui, copy);
	return {
		editor,
		original,
		copy,
		calls,
		release,
		setWidget,
		unsubscribe,
		press: () => {
			listener?.("\x03");
			editor.actionHandlers.get("app.clear")?.();
		},
		setFocus: (component: Component | null) => {
			focused = component;
		},
		listen: () => listener?.("\x03"),
	};
}

describe("attachClearAction", () => {
	it("requests the formatted clipboard text before the original clear action", () => {
		const state = setup("hello [paste #1 1001 chars]", "hello pasted", new Map([[1, "pasted"]]));
		state.press();
		expect(state.calls).toEqual(["copy:hello [paste#1## pasted ##]", "clear"]);
		expect(state.original).toHaveBeenCalledTimes(1);
		expect(state.setWidget).toHaveBeenCalledTimes(2);
		state.release();
		expect(state.unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("does not request a copy for an empty editor and restores only its own handler", () => {
		const state = setup("");
		state.press();
		expect(state.copy).not.toHaveBeenCalled();
		expect(state.original).toHaveBeenCalledTimes(1);
		state.release();
		expect(state.editor.actionHandlers.get("app.clear")).toBe(state.original);
		state.release();
		expect(state.unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("does not overwrite a later handler installed by another extension", () => {
		const state = setup("draft");
		state.listen();
		const replacement = vi.fn();
		state.editor.actionHandlers.set("app.clear", replacement);
		state.release();
		expect(state.editor.actionHandlers.get("app.clear")).toBe(replacement);
	});

	it("does not stack wrappers when a new editor inherits the old handler", () => {
		const state = setup("old");
		state.listen();
		const next: FakeEditor = {
			...state.editor,
			getText: () => "new",
			getExpandedText: () => "new",
			actionHandlers: new Map(state.editor.actionHandlers),
		};
		state.setFocus(next);
		state.listen();
		next.actionHandlers.get("app.clear")?.();
		expect(state.calls).toEqual(["copy:new", "clear"]);
		expect(state.original).toHaveBeenCalledTimes(1);
		state.release();
		expect(next.actionHandlers.get("app.clear")).toBe(state.original);
	});

	it("does not copy when a different component has focus", () => {
		const state = setup("draft");
		state.setFocus({ render: () => [], invalidate: () => {} });
		state.listen();
		expect(state.editor.actionHandlers.get("app.clear")).toBe(state.original);
		state.release();
	});

	it("passes the clear through even if the clipboard request rejects", async () => {
		const state = setup("draft");
		state.copy.mockRejectedValueOnce(new Error("unavailable"));
		state.press();
		await Promise.resolve();
		expect(state.original).toHaveBeenCalledTimes(1);
		state.release();
	});

	it("intercepts pi's real Ctrl+C dispatch with a collapsed paste", () => {
		let focused: Component | null = null;
		let listener: Listener | undefined;
		const tui = {
			getFocusedComponent: () => focused,
			requestRender: () => {},
			terminal: { rows: 24 },
		} as unknown as TUI;
		const theme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
		const keybindings = {
			matches: (data: string, action: string) => action === "app.clear" && data === "\x03",
		} as unknown as KeybindingsManager;
		const editor = new CustomEditor(tui, theme, keybindings);
		focused = editor;
		const content = "甲".repeat(1001);
		editor.handleInput(`\x1b[200~${content}\x1b[201~`);
		const original = vi.fn(() => editor.setText(""));
		editor.onAction("app.clear", original);
		const ui = {
			setWidget: (_: string, factory?: (tui: TUI, theme: unknown) => Component) => {
				if (factory) factory(tui, {});
			},
			onTerminalInput: (handler: Listener) => {
				listener = handler;
				return () => {};
			},
		} as Parameters<typeof attachClearAction>[0];
		const copy = vi.fn(async (_text: string) => {});
		const release = attachClearAction(ui, copy);
		listener?.("\x03");
		editor.handleInput("\x03");
		expect(copy).toHaveBeenCalledExactlyOnceWith(`[paste#1## ${content} ##]`);
		expect(original).toHaveBeenCalledTimes(1);
		expect(editor.getText()).toBe("");
		release();
	});
});
