import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import { formatClipboardPayload } from "./clipboard-payload.js";

type EditorView = Component & {
	actionHandlers: Map<string, () => void>;
	getText(): string;
	getExpandedText(): string;
};

type EditorUI = Pick<ExtensionUIContext, "setWidget" | "onTerminalInput">;
type FocusedTUI = TUI & { getFocusedComponent(): Component | null };

function hasFocusedComponent(tui: TUI): tui is FocusedTUI {
	return "getFocusedComponent" in tui && typeof tui.getFocusedComponent === "function";
}

function isClearEditor(component: Component | null): component is EditorView {
	if (!component || typeof component !== "object") return false;
	const candidate = component as Component & {
		actionHandlers?: unknown;
		getText?: unknown;
		getExpandedText?: unknown;
	};
	return (
		candidate.actionHandlers instanceof Map &&
		typeof candidate.actionHandlers.get("app.clear") === "function" &&
		typeof candidate.getText === "function" &&
		typeof candidate.getExpandedText === "function"
	);
}

export function attachClearAction(ui: EditorUI, copy: (text: string) => Promise<void>): () => void {
	let tui: TUI | undefined;
	const widgetKey = "clear-to-clipboard:terminal";
	ui.setWidget(widgetKey, (current) => {
		tui = current;
		return { render: () => [], invalidate: () => {} };
	});
	ui.setWidget(widgetKey, undefined);
	if (!tui || !hasFocusedComponent(tui)) return () => {};

	const terminal = tui;
	const wrappedEditors = new Map<EditorView, { original: () => void; wrapper: () => void }>();
	const originalForWrapper = new WeakMap<() => void, () => void>();
	const unsubscribe = ui.onTerminalInput(() => {
		const editor = terminal.getFocusedComponent();
		if (!isClearEditor(editor)) return undefined;
		const current = editor.actionHandlers.get("app.clear");
		if (!current || wrappedEditors.get(editor)?.wrapper === current) return undefined;

		const original = originalForWrapper.get(current) ?? current;
		const wrapper = () => {
			try {
				const focused = terminal.getFocusedComponent();
				if (isClearEditor(focused)) {
					const raw = focused.getText();
					if (raw.length > 0) {
						const pastes: unknown = (focused as unknown as Record<string, unknown>).pastes;
						const payload =
							pastes instanceof Map
								? formatClipboardPayload(raw, pastes as ReadonlyMap<number, unknown>)
								: focused.getExpandedText();
						void copy(payload).catch(() => {});
					}
				}
			} finally {
				original();
			}
		};

		originalForWrapper.set(wrapper, original);
		wrappedEditors.set(editor, { original, wrapper });
		editor.actionHandlers.set("app.clear", wrapper);
		return undefined;
	});

	let released = false;
	return () => {
		if (released) return;
		released = true;
		unsubscribe();
		for (const [editor, { original, wrapper }] of wrappedEditors) {
			if (editor.actionHandlers.get("app.clear") === wrapper) {
				editor.actionHandlers.set("app.clear", original);
			}
		}
		const focused = terminal.getFocusedComponent();
		if (isClearEditor(focused)) {
			const current = focused.actionHandlers.get("app.clear");
			const original = current && originalForWrapper.get(current);
			if (original) focused.actionHandlers.set("app.clear", original);
		}
		wrappedEditors.clear();
	};
}
