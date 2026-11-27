/**
 * How a list change is announced, in the form the host can show: a flash in the
 * alternate screen when pi runs fullscreen, a notification toast otherwise.
 *
 * The TUI instance is not handed to extensions directly; a widget factory
 * receives it. So a throwaway widget is registered and removed at once to
 * capture it — the same route clear-to-clipboard takes. When the host never
 * calls the factory (RPC mode, tests), only the toast path exists.
 */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiAltScreen } from "@earendil-works/pi-tui";

type NoticeUI = Pick<ExtensionUIContext, "setWidget" | "notify">;
type FlashingTUI = TUI & Partial<Pick<TuiAltScreen, "flash">>;

const WIDGET_KEY = "skill-ref:terminal";
const FLASH_MS = 1800;

function captureTui(ui: NoticeUI): FlashingTUI | undefined {
	let tui: FlashingTUI | undefined;
	ui.setWidget(WIDGET_KEY, (current) => {
		tui = current;
		return { render: () => [], invalidate: () => {} };
	});
	ui.setWidget(WIDGET_KEY, undefined);
	return tui;
}

/** Builds the notice sink the entry store reports list changes through. */
export function createRefreshNotice(ui: NoticeUI): (message: string) => void {
	const tui = captureTui(ui);
	return (message) => {
		if (tui?.mode === "fullscreen" && typeof tui.flash === "function") {
			tui.flash(message, FLASH_MS);
		} else {
			ui.notify(message, "info");
		}
	};
}
