import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Component, Container, type TUI } from "@earendil-works/pi-tui";
import { CompletionTracker } from "./completion-tracker.js";
import { createComponentBridge } from "./viewport-bridge.js";

class LinesComponent extends Container {
	private lines: string[];

	constructor(lines: string[]) {
		super();
		this.lines = lines;
	}

	override render(): string[] {
		return this.lines;
	}
}

class ForeignContainer implements Component {
	children: Component[] = [];

	addChild(component: Component): void {
		this.children.push(component);
	}

	removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index >= 0) this.children.splice(index, 1);
	}

	render(width: number): string[] {
		return this.children.flatMap((component) => component.render(width));
	}

	invalidate(): void {
		for (const component of this.children) component.invalidate();
	}
}

class AssistantComponent extends LinesComponent {
	updateContent(): void {}
}

class ToolComponent extends LinesComponent {
	toolCallId: string;
	expanded = false;

	constructor(toolCallId: string, lines: string[]) {
		super(lines);
		this.toolCallId = toolCallId;
	}

	updateResult(): void {}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}
}

function createTui(rows: number): { tui: TUI; chat: Container; rendered: () => string[] } {
	const chat = new Container();
	const root = [new Container(), new Container(), chat, new LinesComponent(["editor"])] as const;
	const fake = { children: [...root], terminal: { rows } };
	return {
		tui: fake as unknown as TUI,
		chat,
		rendered: () => fake.children.flatMap((component) => component.render(80)),
	};
}

describe("ComponentBridge", () => {
	it("accepts a container from a different package identity", () => {
		const chat = new ForeignContainer();
		const fake = {
			children: [new Container(), new Container(), chat, new LinesComponent(["editor"])],
			terminal: { rows: 10 },
		};
		assert.equal(chat instanceof Container, false);
		assert.ok(createComponentBridge(fake as unknown as TUI, new CompletionTracker<Component>(), () => false));
	});

	it("keeps an ordinary text assistant on the native path", () => {
		const { tui, chat, rendered } = createTui(4);
		const tracker = new CompletionTracker<Container>();
		const bridge = createComponentBridge(tui, tracker, () => false);
		assert.ok(bridge);
		const assistant = new AssistantComponent(["a", "b", "c", "d", "e"]);
		tracker.beginAssistant();
		chat.addChild(assistant);
		bridge.reconcile();
		assert.equal(chat.children.includes(assistant), true);
		assert.deepEqual(rendered(), ["a", "b", "c", "d", "e", "editor"]);
		tracker.completeAssistant();
		bridge.reconcile();
		assert.equal(chat.children.filter((child) => child === assistant).length, 1);
	});

	it("clips a contained assistant and restores one full copy", () => {
		const { tui, chat, rendered } = createTui(4);
		const tracker = new CompletionTracker<Container>();
		const bridge = createComponentBridge(tui, tracker, () => false);
		assert.ok(bridge);
		const assistant = new AssistantComponent(["a", "b", "c", "d", "e"]);
		tracker.beginAssistant();
		tracker.containCurrentAssistant();
		chat.addChild(assistant);
		bridge.reconcile();
		assert.deepEqual(rendered(), ["c", "d", "e", "editor"]);
		assert.equal(chat.children.includes(assistant), false);

		tracker.completeAssistant();
		bridge.reconcile();
		assert.deepEqual(rendered(), ["a", "b", "c", "d", "e", "editor"]);
		assert.equal(chat.children.filter((child) => child === assistant).length, 1);
		bridge.restore();
	});

	it("commits parallel tools in source order", () => {
		const { tui, chat } = createTui(10);
		const tracker = new CompletionTracker<Container>();
		const bridge = createComponentBridge(tui, tracker, () => false);
		assert.ok(bridge);
		const first = new ToolComponent("first", ["first"]);
		const second = new ToolComponent("second", ["second"]);
		tracker.ensureTool("first");
		tracker.ensureTool("second");
		chat.addChild(first);
		chat.addChild(second);
		bridge.reconcile();

		tracker.completeTool("second");
		bridge.reconcile();
		assert.equal(chat.children.includes(second), false);
		tracker.completeTool("first");
		bridge.reconcile();
		assert.deepEqual(chat.children.slice(0, 2), [first, second]);
	});

	it("synchronizes expansion inside the live region", () => {
		const { tui, chat } = createTui(10);
		const tracker = new CompletionTracker<Container>();
		let expanded = false;
		const bridge = createComponentBridge(tui, tracker, () => expanded);
		assert.ok(bridge);
		const tool = new ToolComponent("tool", ["tool"]);
		tracker.ensureTool("tool");
		chat.addChild(tool);
		bridge.reconcile();
		expanded = true;
		bridge.reconcile();
		assert.equal(tool.expanded, true);
	});
});
