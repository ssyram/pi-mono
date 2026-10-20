import assert from "node:assert/strict";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export function createLoopWidgetFixture(
	mode: "fullscreen" | "regular",
	rows = 40,
	otherWidgetRows = 0,
) {
	let content: Component | undefined;
	let renders = 0;
	const theme = {
		fg: (_color: string, text: string) => text,
	} as unknown as Theme;
	const tui = {
		mode,
		children: [],
		terminal: { rows, columns: 80 },
		requestRender: () => {
			renders++;
		},
	} as unknown as TUI;
	const fixed = (height: number): Component => ({
		render: () => Array.from({ length: height }, () => "fixed"),
		invalidate() {},
	});
	tui.children = [
		fixed(200),
		fixed(0),
		fixed(1),
		{
			render: (width) => [
				...fixed(otherWidgetRows).render(width),
				...(content?.render(width) ?? []),
			],
			invalidate() {},
		},
		fixed(3),
		fixed(0),
		fixed(1),
	];
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			notify() {},
			setWidget: (
				_key: string,
				factory: ((tui: TUI, theme: Theme) => Component) | undefined,
				options?: { placement?: string },
			) => {
				content = factory?.(tui, theme);
				if (factory) assert.equal(options?.placement, "aboveEditor");
			},
		},
	} as unknown as ExtensionContext;
	return {
		ctx,
		tui,
		get header() {
			return content;
		},
		get renders() {
			return renders;
		},
	};
}
