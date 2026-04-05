import { getKeybindings, matchesKey } from "@mariozechner/pi-tui";
import type { KeyMap } from "./types.js";

export function createKeyMap(): KeyMap {
	const kb = getKeybindings();
	return {
		cancel: (data) => kb.matches(data, "tui.select.cancel"),
		confirm: (data) => kb.matches(data, "tui.select.confirm"),
		up: (data) => kb.matches(data, "tui.select.up"),
		down: (data) => kb.matches(data, "tui.select.down"),
		left: (data) => matchesKey(data, "left"),
		right: (data) => matchesKey(data, "right"),
		tab: (data) => kb.matches(data, "tui.input.tab"),
		shiftTab: (data) => matchesKey(data, "shift+tab"),
		space: (data) => matchesKey(data, "space"),
	};
}
