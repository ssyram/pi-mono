import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Container, type Terminal, type TUI } from "@earendil-works/pi-tui";
import { CompletionTracker } from "./completion-tracker.js";
import { installRuntimePatch } from "./runtime-patch.js";

class AssistantComponent extends Container {
	private lines: string[];

	constructor(lines: string[]) {
		super();
		this.lines = lines;
	}

	updateContent(): void {}

	override render(): string[] {
		return this.lines;
	}
}

class ThrowingExpandableAssistant extends AssistantComponent {
	setExpanded(): void {
		throw new Error("expanded state failed");
	}
}

class FakeTui extends Container {
	terminal: Terminal;
	stopped = false;
	overlayStack: unknown[] = [];
	previousLines = ["history", "editor"];
	previousWidth = 80;
	previousHeight = 24;
	previousViewportTop = 0;
	cursorRow = 1;
	hardwareCursorRow = 1;
	maxLinesRendered = 2;
	clearOnShrink = false;
	nativeRenders = 0;
	lastForce: boolean | undefined;
	writes: string[] = [];

	constructor(rows = 24) {
		super();
		this.previousHeight = rows;
		this.terminal = {
			columns: 80,
			rows,
			write: (data: string) => this.writes.push(data),
		} as unknown as Terminal;
		this.addChild(new Container());
		this.addChild(new Container());
		this.addChild(new Container());
		this.addChild(new AssistantComponent(["editor"]));
	}

	extractCursorPosition(): undefined {
		return undefined;
	}

	applyLineResets(lines: string[]): string[] {
		return lines;
	}

	positionHardwareCursor(): void {}

	requestRender(force = false): void {
		this.lastForce = force;
	}

	doRender(): void {
		this.nativeRenders++;
	}

	start(): void {
		this.stopped = false;
	}

	stop(): void {
		this.stopped = true;
	}
}

function chatOf(tui: FakeTui): Container {
	return tui.children[2] as Container;
}

function install(tui: FakeTui, tracker = new CompletionTracker<Container>(), getExpanded: () => boolean = () => false) {
	return installRuntimePatch(tui as unknown as TUI, tracker, getExpanded, () => {});
}

describe("RuntimePatch", () => {
	it("patches only doRender during the active run", () => {
		const tui = new FakeTui();
		const originalDoRender = tui.doRender;
		const originalRequestRender = tui.requestRender;
		const originalStart = tui.start;
		const originalStop = tui.stop;
		const patch = install(tui);
		assert.ok(patch);
		assert.equal(Object.hasOwn(tui, "doRender"), true);
		assert.equal(tui.requestRender, originalRequestRender);
		assert.equal(tui.start, originalStart);
		assert.equal(tui.stop, originalStop);
		patch.dispose();
		assert.equal(Object.hasOwn(tui, "doRender"), false);
		assert.equal(tui.doRender, originalDoRender);
	});

	it("uses the native renderer without direct terminal writes", () => {
		const tui = new FakeTui(4);
		const tracker = new CompletionTracker<Container>();
		const assistant = new AssistantComponent(["a", "b", "c", "d", "e"]);
		const patch = install(tui, tracker);
		assert.ok(patch);
		tracker.beginAssistant();
		chatOf(tui).addChild(assistant);
		tui.doRender();
		assert.equal(tui.nativeRenders, 1);
		assert.deepEqual(tui.writes, []);
		patch.dispose();
		assert.equal(chatOf(tui).children.filter((child) => child === assistant).length, 1);
	});

	it("restores a finalized component exactly once", () => {
		const tui = new FakeTui();
		const tracker = new CompletionTracker<Container>();
		const assistant = new AssistantComponent(["done"]);
		const patch = install(tui, tracker);
		assert.ok(patch);
		tracker.beginAssistant();
		chatOf(tui).addChild(assistant);
		tui.doRender();
		tracker.completeAssistant();
		tui.doRender();
		assert.equal(chatOf(tui).children.filter((child) => child === assistant).length, 1);
		patch.dispose();
		assert.equal(chatOf(tui).children.filter((child) => child === assistant).length, 1);
	});

	it("preserves forced renders and terminal lifecycle methods", () => {
		const tui = new FakeTui();
		const patch = install(tui);
		assert.ok(patch);
		tui.requestRender(true);
		assert.equal(tui.lastForce, true);
		tui.stop();
		tui.start();
		assert.equal(Object.hasOwn(tui, "doRender"), true);
		assert.equal(patch.dispose().deferredAlignment, false);
	});

	it("fails open before native rendering when reconciliation fails", () => {
		const tui = new FakeTui();
		const tracker = new CompletionTracker<Container>();
		let expanded = false;
		const assistant = new ThrowingExpandableAssistant(["live"]);
		const patch = install(tui, tracker, () => expanded);
		assert.ok(patch);
		tracker.beginAssistant();
		tracker.containCurrentAssistant();
		chatOf(tui).addChild(assistant);
		tui.doRender();
		expanded = true;
		tui.doRender();
		assert.equal(tui.nativeRenders, 2);
		assert.equal(Object.hasOwn(tui, "doRender"), false);
		assert.equal(chatOf(tui).children.filter((child) => child === assistant).length, 1);
	});

	it("refuses an unknown instance renderer without modifying it", () => {
		const tui = new FakeTui();
		const foreign = () => {};
		tui.doRender = foreign;
		const patch = install(tui);
		assert.equal(patch, undefined);
		assert.equal(tui.doRender, foreign);
	});
});
