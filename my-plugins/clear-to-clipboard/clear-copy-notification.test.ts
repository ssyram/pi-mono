import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMode } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { attachClearAction } from "./attach-clear-action.js";

type Listener = Parameters<ExtensionUIContext["onTerminalInput"]>[0];

function setup(copy: (text: string) => Promise<void>, mode: TuiMode = "fullscreen", withFlash = true) {
	let text = "draft";
	let listener: Listener | undefined;
	const original = vi.fn(() => {
		text = "";
	});
	const editor = {
		render: () => [],
		invalidate: () => {},
		actionHandlers: new Map([["app.clear", original]]),
		getText: () => text,
		getExpandedText: () => text,
	};
	const flash = vi.fn();
	const tui = {
		mode,
		getFocusedComponent: () => editor,
		...(withFlash ? { flash } : {}),
	} as unknown as TUI;
	const notify = vi.fn();
	const release = attachClearAction(
		{
			notify,
			setWidget: (_: string, factory?: (tui: TUI, theme: unknown) => Component) => {
				if (factory) factory(tui, {});
			},
			onTerminalInput: (handler: Listener) => {
				listener = handler;
				return () => {};
			},
		} as Parameters<typeof attachClearAction>[0],
		copy,
	);
	return {
		flash,
		notify,
		original,
		editor,
		release,
		press: () => {
			listener?.("\x03");
			editor.actionHandlers.get("app.clear")?.();
		},
	};
}

describe("clear copy notification", () => {
	it("clears immediately and flashes only after the copy resolves", async () => {
		const pending = Promise.withResolvers<void>();
		const copy = vi.fn(() => pending.promise);
		const state = setup(copy);
		state.press();
		expect(copy).toHaveBeenCalledExactlyOnceWith("draft");
		expect(state.editor.getText()).toBe("");
		expect(state.original).toHaveBeenCalledTimes(1);
		expect(state.flash).not.toHaveBeenCalled();
		pending.resolve();
		await pending.promise;
		expect(state.flash).toHaveBeenCalledExactlyOnceWith("Copied cleared input", 1800);
		expect(state.notify).not.toHaveBeenCalled();
		state.release();
	});

	it("uses extension notifications in regular mode", async () => {
		const state = setup(async () => {}, "regular");
		state.press();
		await Promise.resolve();
		expect(state.notify).toHaveBeenCalledExactlyOnceWith("Copied cleared input", "info");
		expect(state.flash).not.toHaveBeenCalled();
		state.release();
	});

	it("uses extension notifications when the renderer has no flash method", async () => {
		const state = setup(async () => {}, "fullscreen", false);
		state.press();
		await Promise.resolve();
		expect(state.notify).toHaveBeenCalledExactlyOnceWith("Copied cleared input", "info");
		state.release();
	});

	it.each(["fullscreen", "regular"] as const)("reports copy failure without delaying clear in %s", async (mode) => {
		const state = setup(async () => {
			throw new Error("unavailable");
		}, mode);
		state.press();
		expect(state.editor.getText()).toBe("");
		expect(state.original).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		if (mode === "fullscreen") {
			expect(state.flash).toHaveBeenCalledExactlyOnceWith("Copy failed (input cleared)", 3000);
		} else {
			expect(state.notify).toHaveBeenCalledExactlyOnceWith("Copy failed (input cleared)", "error");
		}
		state.release();
	});

	it.each([true, false])("does not notify after release when copied=%s", async (copied) => {
		const pending = Promise.withResolvers<void>();
		const state = setup(() => pending.promise);
		state.press();
		state.release();
		if (copied) pending.resolve();
		else pending.reject(new Error("unavailable"));
		await Promise.resolve();
		expect(state.flash).not.toHaveBeenCalled();
		expect(state.notify).not.toHaveBeenCalled();
	});

	it("does not copy or notify when the editor is already empty", async () => {
		const copy = vi.fn(async () => {});
		const state = setup(copy);
		state.press();
		await Promise.resolve();
		state.flash.mockClear();
		copy.mockClear();
		state.press();
		await Promise.resolve();
		expect(copy).not.toHaveBeenCalled();
		expect(state.flash).not.toHaveBeenCalled();
		expect(state.notify).not.toHaveBeenCalled();
		state.release();
	});
});
