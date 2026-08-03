import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

const PROBE_WIDGET_KEY = "codex-viewport:tui-probe";
const emptyComponent: Component = { render: () => [], invalidate: () => {} };

function getTui(ctx: ExtensionContext): TUI | undefined {
	let result: TUI | undefined;
	ctx.ui.setWidget(PROBE_WIDGET_KEY, (tui) => {
		result = tui;
		return emptyComponent;
	});
	ctx.ui.setWidget(PROBE_WIDGET_KEY, undefined);
	return result;
}

export { getTui };
