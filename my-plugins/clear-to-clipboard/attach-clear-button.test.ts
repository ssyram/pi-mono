import type { TUI, TuiMode, TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { attachClearButton } from "./attach-clear-button.js";

function setup() {
	let mode: TuiMode = "fullscreen";
	const originalBorder = vi.fn((width: number, _hidden: number) => "─".repeat(width));
	const originalMouse = vi.fn((_event: TuiMouseEvent) => undefined);
	const editor = {
		borderColor: vi.fn((text: string) => `\x1b[36m${text}\x1b[0m`),
		renderTopBorder: originalBorder,
		render: (width: number): string[] => [editor.renderTopBorder(width, 0)],
		invalidate: () => {},
		handleMouse: originalMouse,
	};
	const clear = vi.fn();
	const tui = {
		get mode() {
			return mode;
		},
	} as TUI;
	const style = vi.fn((text: string) => `\x1b[44m${text}\x1b[0m`);
	const release = attachClearButton(editor, tui, clear, style);
	const event: TuiMouseEvent = {
		type: "click",
		button: "left",
		x: 74,
		y: 0,
		screenX: 74,
		screenY: 0,
		width: 80,
		height: 3,
		shift: false,
		alt: false,
		ctrl: false,
	};
	return {
		editor,
		clear,
		style,
		release,
		originalBorder,
		originalMouse,
		event,
		setMode: (next: TuiMode) => {
			mode = next;
		},
	};
}

describe("fullscreen clear button", () => {
	it("styles seven columns with a three-column right margin and clears on click, not press", () => {
		const state = setup();
		expect(state.editor.render(80)[0]).toBe(`${"─".repeat(70)}\x1b[44m Clear \x1b[0m\x1b[36m───\x1b[0m`);
		expect(state.editor.borderColor).toHaveBeenCalledWith("───");
		expect(state.style).toHaveBeenCalledWith(" Clear ");
		expect(state.originalBorder).toHaveBeenCalledWith(70, 0);
		expect(state.editor.handleMouse({ ...state.event, type: "press" })).toEqual({
			handled: true,
			focus: true,
			render: false,
		});
		expect(state.clear).not.toHaveBeenCalled();
		state.editor.handleMouse(state.event);
		expect(state.clear).toHaveBeenCalledTimes(1);
		state.release();
	});

	it("hides the button in regular mode and at narrow widths, and rejects stale coordinates", () => {
		const state = setup();
		state.editor.render(80);
		state.setMode("regular");
		expect(state.editor.render(80)[0]).toBe("─".repeat(80));
		state.editor.handleMouse(state.event);
		state.setMode("fullscreen");
		expect(state.editor.render(10)[0]).toBe("─".repeat(10));
		state.editor.handleMouse({ ...state.event, width: 10, x: 8 });
		state.editor.render(100);
		state.editor.handleMouse(state.event);
		expect(state.clear).not.toHaveBeenCalled();
		state.editor.handleMouse({ ...state.event, width: 100, x: 94 });
		expect(state.clear).toHaveBeenCalledTimes(1);
		state.release();
	});

	it("forwards non-button gestures and restores the original methods", () => {
		const state = setup();
		state.editor.render(80);
		for (const event of [
			{ ...state.event, x: 69 },
			{ ...state.event, x: 79 },
			{ ...state.event, y: 1 },
			{ ...state.event, button: "right" as const },
			{ ...state.event, type: "wheel" as const },
		]) {
			state.editor.handleMouse(event);
			expect(state.originalMouse).toHaveBeenLastCalledWith(event);
		}
		expect(state.clear).not.toHaveBeenCalled();
		state.release();
		state.release();
		expect(state.editor.renderTopBorder).toBe(state.originalBorder);
		expect(state.editor.handleMouse).toBe(state.originalMouse);
	});

	it("does not replace hooks installed later by another extension", () => {
		const state = setup();
		const replacementBorder = vi.fn(() => "other");
		const replacementMouse = vi.fn(() => undefined);
		state.editor.renderTopBorder = replacementBorder;
		state.editor.handleMouse = replacementMouse;
		state.release();
		expect(state.editor.renderTopBorder).toBe(replacementBorder);
		expect(state.editor.handleMouse).toBe(replacementMouse);
	});

	it("contains render, clear, mouse and release failures", () => {
		const state = setup();
		state.originalBorder.mockImplementationOnce(() => {
			throw new Error("render failed");
		});
		expect(state.editor.render(80)).toEqual(["─".repeat(80)]);
		state.style.mockImplementationOnce(() => {
			throw new Error("theme failed");
		});
		expect(state.editor.render(80)).toEqual(["─".repeat(80)]);
		state.editor.render(80);
		state.clear.mockImplementation(() => {
			throw new Error("clear failed");
		});
		expect(() => state.editor.handleMouse(state.event)).not.toThrow();
		state.originalMouse.mockImplementation(() => {
			throw new Error("mouse failed");
		});
		expect(() => state.editor.handleMouse({ ...state.event, x: 1 })).not.toThrow();
		Object.freeze(state.editor);
		expect(() => state.release()).not.toThrow();
		expect(() => state.editor.handleMouse(state.event)).not.toThrow();
		expect(state.clear).toHaveBeenCalledTimes(1);
	});

	it("does not throw when hooks are absent, frozen or fail during installation", () => {
		const tui = { mode: "fullscreen" } as TUI;
		const component = { render: () => [], invalidate: () => {} };
		expect(() => attachClearButton(component, tui, vi.fn(), (text) => text)()).not.toThrow();
		const border = (_width: number, _hidden: number) => "original";
		const frozen = Object.freeze({ ...component, renderTopBorder: border });
		expect(() => attachClearButton(frozen, tui, vi.fn(), (text) => text)()).not.toThrow();
		expect(frozen.renderTopBorder).toBe(border);
		const blocked = { ...component, renderTopBorder: border };
		Object.defineProperty(blocked, "handleMouse", { value: undefined, writable: false });
		expect(() => attachClearButton(blocked, tui, vi.fn(), (text) => text)()).not.toThrow();
		expect(blocked.renderTopBorder).toBe(border);
	});
});
