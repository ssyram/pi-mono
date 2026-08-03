import type { Component, TUI } from "@earendil-works/pi-tui";
import type { CompletionTracker } from "./completion-tracker.js";
import type { ContainerComponent } from "./component-shapes.js";
import { visibleLiveLines } from "./visible-live-lines.js";

class LiveRegion implements Component {
	private tui: TUI;
	private chat: ContainerComponent;
	private tracker: CompletionTracker<Component>;

	constructor(tui: TUI, chat: ContainerComponent, tracker: CompletionTracker<Component>) {
		this.tui = tui;
		this.chat = chat;
		this.tracker = tracker;
	}

	render(width: number): string[] {
		const liveLines = this.tracker.components().flatMap((component) => component.render(width));
		return visibleLiveLines(liveLines, this.tui.terminal.rows, this.trailingRows(width));
	}

	invalidate(): void {
		for (const component of this.tracker.components()) component.invalidate?.();
	}

	private trailingRows(width: number): number {
		let rows = 0;
		const liveIndex = this.chat.children.indexOf(this);
		if (liveIndex >= 0) {
			for (const component of this.chat.children.slice(liveIndex + 1)) rows += component.render(width).length;
		}
		const chatIndex = this.tui.children.indexOf(this.chat);
		if (chatIndex >= 0) {
			for (const component of this.tui.children.slice(chatIndex + 1)) rows += component.render(width).length;
		}
		return rows;
	}
}

export { LiveRegion };
