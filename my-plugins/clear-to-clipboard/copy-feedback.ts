import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiAltScreen } from "@earendil-works/pi-tui";

export function showCopyFeedback(tui: TUI, notify: ExtensionUIContext["notify"], copied: boolean): void {
	const message = copied ? "Copied cleared input" : "Copy failed (input cleared)";
	const renderer = tui as TUI & Partial<Pick<TuiAltScreen, "flash">>;
	if (renderer.mode === "fullscreen" && typeof renderer.flash === "function") {
		renderer.flash(message, copied ? 1800 : 3000);
	} else {
		notify(message, copied ? "info" : "error");
	}
}
