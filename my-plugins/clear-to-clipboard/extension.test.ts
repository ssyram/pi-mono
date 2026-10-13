import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { type Component, type EditorTheme, type KeyId, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { CustomEditor } from "../../packages/coding-agent/src/modes/interactive/components/custom-editor.js";

import clearToClipboard from "./extension.js";

vi.mock("@earendil-works/pi-coding-agent", () => ({ copyToClipboard: vi.fn(async () => {}) }));

type EventHandler = (event: unknown, ctx: ExtensionContext) => void;
type ShortcutHandler = (ctx: ExtensionContext) => void | Promise<void>;
type InputListener = Parameters<ExtensionContext["ui"]["onTerminalInput"]>[0];

function setup() {
	const hooks = new Map<string, Set<EventHandler>>();
	const shortcuts = new Map<KeyId, ShortcutHandler>();
	const api = {
		registerShortcut: (key: KeyId, options: { handler: ShortcutHandler }) => shortcuts.set(key, options.handler),
		on: (event: string, handler: EventHandler) => {
			const handlers = hooks.get(event) ?? new Set<EventHandler>();
			handlers.add(handler);
			hooks.set(event, handlers);
			return () => handlers.delete(handler);
		},
	} as unknown as ExtensionAPI;
	clearToClipboard(api);
	return {
		shortcuts,
		emit: (event: string, ctx: ExtensionContext) => {
			for (const handler of [...(hooks.get(event) ?? [])]) handler({}, ctx);
		},
		createSession: () => {
			const listeners = new Set<InputListener>();
			let focused: Component | null = null;
			const tui = {
				getFocusedComponent: () => focused,
				requestRender: () => {},
				terminal: { rows: 24 },
			} as unknown as TUI;
			const keybindings = {
				matches: (data: string, action: string) => action === "app.clear" && data === "\x03",
			} as unknown as KeybindingsManager;
			const theme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
			const editor = new CustomEditor(tui, theme, keybindings);
			focused = editor;
			const original = vi.fn(() => editor.setText(""));
			editor.onAction("app.clear", original);
			const ctx = {
				mode: "tui",
				sessionManager: {},
				ui: {
					notify: vi.fn(),
					setWidget: (_key: string, factory?: (tui: TUI, theme: unknown) => Component) => {
						factory?.(tui, {});
					},
					onTerminalInput: (handler: InputListener) => {
						listeners.add(handler);
						return () => listeners.delete(handler);
					},
				},
			} as unknown as ExtensionContext;
			editor.onExtensionShortcut = (data) => {
				for (const [key, handler] of shortcuts) {
					if (matchesKey(data, key)) {
						void handler({ ...ctx });
						return true;
					}
				}
				return false;
			};
			return {
				ctx,
				editor,
				original,
				press: (data: string) => {
					for (const listener of listeners) listener(data);
					editor.handleInput(data);
				},
			};
		},
	};
}

describe("clear-only extension shortcut", () => {
	it.each(["\x1b\x03", "\x1b[99;7u"])("clears a collapsed paste without copying for %j", (data) => {
		vi.mocked(copyToClipboard).mockClear();
		const state = setup();
		const session = state.createSession();
		state.emit("session_start", session.ctx);
		session.editor.handleInput(`\x1b[200~${"甲".repeat(1001)}\x1b[201~`);
		expect(state.shortcuts.has("ctrl+alt+c")).toBe(true);
		session.press(data);
		expect(session.original).toHaveBeenCalledTimes(1);
		expect(session.editor.getExpandedText()).toBe("");
		expect(copyToClipboard).not.toHaveBeenCalled();
		session.editor.setText("protected input");
		session.press("\x03");
		expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith("protected input");
		expect(session.original).toHaveBeenCalledTimes(2);
		state.emit("session_shutdown", session.ctx);
	});

	it("isolates sessions and removes only the stopped session's shortcut action", () => {
		const state = setup();
		const first = state.createSession();
		const second = state.createSession();
		state.emit("session_start", first.ctx);
		state.emit("session_start", second.ctx);
		first.editor.setText("first");
		second.editor.setText("second");
		first.press("\x1b\x03");
		expect(first.editor.getText()).toBe("");
		expect(second.editor.getText()).toBe("second");
		state.emit("session_shutdown", first.ctx);
		first.editor.setText("stopped");
		first.press("\x1b\x03");
		expect(first.editor.getText()).toBe("stopped");
		second.press("\x1b\x03");
		expect(second.original).toHaveBeenCalledTimes(1);
		state.emit("session_shutdown", second.ctx);
	});

	it("does not attach the action outside TUI mode", () => {
		const state = setup();
		const session = state.createSession();
		state.emit("session_start", { ...session.ctx, mode: "rpc" });
		session.editor.setText("draft");
		session.press("\x1b\x03");
		expect(session.original).not.toHaveBeenCalled();
		expect(session.editor.getText()).toBe("draft");
	});
});
