import type { Component, TUI } from "@earendil-works/pi-tui";

type TopBorder = (width: number, hiddenLineCount: number) => string;
type BorderEditor = Component & { renderTopBorder?: TopBorder; borderColor?: (text: string) => string };

export function attachClearButton(
	component: Component,
	tui: TUI,
	clear: () => void,
	style: (text: string) => string,
): () => void {
	const editor = component as BorderEditor;
	const label = " Clear ";
	const rightMargin = 3;
	let active = true;
	let renderedWidth = 0;
	let border: TopBorder | undefined;
	let mouse: Component["handleMouse"];
	let borderDescriptor: PropertyDescriptor | undefined;
	let mouseDescriptor: PropertyDescriptor | undefined;
	const release = () => {
		active = false;
		try {
			if (border && editor.renderTopBorder === border) {
				if (borderDescriptor) Reflect.defineProperty(editor, "renderTopBorder", borderDescriptor);
				else Reflect.deleteProperty(editor, "renderTopBorder");
			}
		} catch {}
		try {
			if (mouse && editor.handleMouse === mouse) {
				if (mouseDescriptor) Reflect.defineProperty(editor, "handleMouse", mouseDescriptor);
				else Reflect.deleteProperty(editor, "handleMouse");
			}
		} catch {}
	};
	try {
		const originalBorder = editor.renderTopBorder;
		if (typeof originalBorder !== "function") return release;
		const originalMouse = editor.handleMouse;
		borderDescriptor = Object.getOwnPropertyDescriptor(editor, "renderTopBorder");
		mouseDescriptor = Object.getOwnPropertyDescriptor(editor, "handleMouse");
		border = (width, hiddenLineCount) => {
			renderedWidth = 0;
			try {
				if (!active || tui.mode !== "fullscreen" || width < label.length + rightMargin + 5) {
					return originalBorder.call(editor, width, hiddenLineCount);
				}
				const styledLabel = style(label);
				const line = originalBorder.call(editor, width - label.length - rightMargin, hiddenLineCount);
				const rightBorder = "─".repeat(rightMargin);
				const styledRightBorder =
					typeof editor.borderColor === "function" ? editor.borderColor(rightBorder) : rightBorder;
				renderedWidth = width;
				return line + styledLabel + styledRightBorder;
			} catch {
				return "─".repeat(Math.max(0, width));
			}
		};
		mouse = (event) => {
			try {
				const onButton =
					active &&
					tui.mode === "fullscreen" &&
					renderedWidth === event.width &&
					renderedWidth >= label.length + rightMargin + 5 &&
					event.y === 0 &&
					event.x >= renderedWidth - label.length - rightMargin &&
					event.x < renderedWidth - rightMargin &&
					event.button === "left";
				if (onButton && event.type === "press") return { handled: true, focus: true, render: false };
				if (onButton && event.type === "click") {
					clear();
					return { handled: true, focus: true, render: true };
				}
				return originalMouse?.call(editor, event);
			} catch {
				return { handled: true, render: false };
			}
		};
		if (!Reflect.set(editor, "renderTopBorder", border) || !Reflect.set(editor, "handleMouse", mouse)) release();
	} catch {
		release();
	}
	return release;
}
