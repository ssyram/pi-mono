import type { Component, TUI } from "@earendil-works/pi-tui";
import {
	type ContainerComponent,
	isAssistantComponent,
	isContainerComponent,
	isExpandableComponent,
	toolCallIdOf,
} from "./component-shapes.js";
import type { CompletionTracker } from "./completion-tracker.js";
import { LiveRegion } from "./live-region.js";

class ComponentBridge {
	private tui: TUI;
	private chat: ContainerComponent;
	private tracker: CompletionTracker<Component>;
	private liveRegion: LiveRegion;
	private getToolsExpanded: () => boolean;
	private seen = new WeakSet<object>();
	private lastToolsExpanded: boolean;

	constructor(tui: TUI, chat: ContainerComponent, tracker: CompletionTracker<Component>, getToolsExpanded: () => boolean) {
		this.tui = tui;
		this.chat = chat;
		this.tracker = tracker;
		this.liveRegion = new LiveRegion(tui, chat, tracker);
		this.getToolsExpanded = getToolsExpanded;
		this.lastToolsExpanded = getToolsExpanded();
		for (const component of chat.children) this.seen.add(component);
	}

	reconcile(): void {
		for (const component of [...this.chat.children]) {
			if (component === this.liveRegion) continue;
			if (this.tracker.contains(component)) {
				if (this.tracker.shouldContain(component)) this.moveIntoLiveRegion(component);
				continue;
			}
			if (this.seen.has(component)) continue;
			this.seen.add(component);
			const toolCallId = toolCallIdOf(component);
			const attached = toolCallId
				? this.tracker.attachTool(toolCallId, component)
				: isAssistantComponent(component) && this.tracker.attachNextAssistant(component);
			if (attached && this.tracker.shouldContain(component)) this.moveIntoLiveRegion(component);
			else if (!attached && this.tracker.hasOpenAssistant()) this.moveBeforeLiveRegion(component);
		}

		const expanded = this.getToolsExpanded();
		if (expanded !== this.lastToolsExpanded) {
			for (const component of this.tracker.components()) {
				if (isExpandableComponent(component)) component.setExpanded(expanded);
			}
			this.lastToolsExpanded = expanded;
		}

		const released = this.tracker
			.releaseCompletedPrefix()
			.filter((component) => !this.chat.children.includes(component));
		if (released.length > 0) this.insertBeforeLiveRegion(released);
		if (this.tracker.components().length === 0) this.chat.removeChild(this.liveRegion);
	}

	restore(): void {
		const detached = this.tracker.components().filter((component) => !this.chat.children.includes(component));
		this.insertBeforeLiveRegion(detached);
		this.chat.removeChild(this.liveRegion);
	}

	private moveIntoLiveRegion(component: Component): void {
		const componentIndex = this.chat.children.indexOf(component);
		if (componentIndex < 0) return;
		this.chat.removeChild(component);
		if (!this.chat.children.includes(this.liveRegion)) {
			this.chat.children.splice(componentIndex, 0, this.liveRegion);
		}
	}

	private moveBeforeLiveRegion(component: Component): void {
		const liveIndex = this.chat.children.indexOf(this.liveRegion);
		const componentIndex = this.chat.children.indexOf(component);
		if (liveIndex < 0 || componentIndex <= liveIndex) return;
		this.chat.removeChild(component);
		this.chat.children.splice(liveIndex, 0, component);
	}

	private insertBeforeLiveRegion(components: Component[]): void {
		const liveIndex = this.chat.children.indexOf(this.liveRegion);
		const index = liveIndex < 0 ? this.chat.children.length : liveIndex;
		this.chat.children.splice(index, 0, ...components);
	}
}

function createComponentBridge(
	tui: TUI,
	tracker: CompletionTracker<Component>,
	getToolsExpanded: () => boolean,
): ComponentBridge | undefined {
	const chat = tui.children[2];
	if (!isContainerComponent(chat)) return undefined;
	return new ComponentBridge(tui, chat, tracker, getToolsExpanded);
}

export { ComponentBridge, createComponentBridge };
