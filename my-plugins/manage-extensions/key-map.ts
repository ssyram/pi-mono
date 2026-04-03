import { getKeybindings } from "@mariozechner/pi-tui";
import type { KeyMap } from "./types.js";

export function createKeyMap(): KeyMap {
	const kb = getKeybindings();
	return {
		cancel: (data) => kb.matches(data, "tui.select.cancel"),
		confirm: (data) => kb.matches(data, "tui.select.confirm"),
		up: (data) => kb.matches(data, "tui.select.up"),
		down: (data) => kb.matches(data, "tui.select.down"),
		left: (data) => kb.matches(data, "tui.select.left"),
		right: (data) => kb.matches(data, "tui.select.right"),
		tab: (data) => kb.matches(data, "tui.input.tab"),
		shiftTab: (data) => kb.matches(data, "tui.select.shiftTab"),
		space: (data) => kb.matches(data, "tui.select.toggle"),
	};
}
