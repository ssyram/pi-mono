import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { createRunningWidget } from "../src/loop-running-widget.js";
import {
	type LoopWidgetItem,
	loopWidgetLines,
} from "../src/loop-widget-items.js";
import { createLoopWidgetFixture as fixture } from "./loop-widget-fixture.js";

const row: LoopWidgetItem = {
	id: "session:example",
	running: {
		id: "session:example",
		wakeUpId: "run",
		success: 2,
		completed: 3,
		total: 5,
		current: {
			cwd: "/work",
			path: "/work/当前脚本很长\n.sh",
			params: ["a b"],
			timeoutSeconds: null,
		},
	},
};
const click: TuiMouseEvent = {
	type: "click",
	button: "left",
	x: 0,
	y: 0,
	screenX: 0,
	screenY: 20,
	width: 80,
	height: 1,
	shift: false,
	alt: false,
	ctrl: false,
};
test("rows are one per item with countdown or I/K/M and current command", () => {
	const lines = loopWidgetLines(
		[row, { id: "waiting", nextRunAt: 11000 }],
		80,
		1000,
	);
	assert.equal(lines.length, 2);
	assert.match(lines[0] ?? "", /Running \(2\/3\/5\)/);
	assert.match(lines[0] ?? "", /当前脚本/);
	assert.match(lines[1] ?? "", /Waiting 10s/);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 80);
		assert.ok(!line.includes("\n"));
	}
});

test("waiting items keep a nonzero summary; zero and show off hide it", async () => {
	const setup = fixture("fullscreen");
	let items: LoopWidgetItem[] = [
		{ id: "future", nextRunAt: Date.now() + 60000 },
	];
	const widget = createRunningWidget(setup.ctx, () => items);
	widget.refresh();
	assert.match(
		setup.header?.render(80)[0] ?? "",
		/\u25D3 Loop · 1 scheduled/,
	);
	widget.setVisible(false);
	assert.equal(setup.header, undefined);
	widget.setVisible(true);
	assert.ok(setup.header);
	items = [
		{ id: "future", nextRunAt: Date.now() + 60000 },
		{
			id: "busy",
			running: {
				id: "busy",
				wakeUpId: "busy",
				success: 0,
				completed: 0,
				total: 2,
			},
		},
	];
	widget.refresh();
	const header = setup.header as { render(w: number): string[] } | undefined;
	assert.ok(header, "header must exist");
	assert.match(
		header.render(80)[0] ?? "",
		/\u25D3 Loop · 2 scheduled · 1 running/,
	);
	items = [];
	widget.refresh();
	assert.equal(setup.header, undefined);
	widget.dispose();
	await widget.show();
	assert.equal(setup.header, undefined);
});

test("fullscreen clicks expand in place with at most ten total lines and live snapshots", async () => {
	const setup = fixture("fullscreen");
	let items = Array.from({ length: 15 }, (_, i) => ({
		id: `item:${i}`,
		nextRunAt: Date.now() + 60000,
	}));
	const widget = createRunningWidget(setup.ctx, () => items);
	widget.refresh();
	const header = setup.header;
	assert.ok(header);
	header.render(80);
	assert.equal(header.handleMouse?.(click)?.handled, true);
	assert.equal(header.render(80).length, 10);
	items = items.slice(0, 2);
	widget.refresh();
	assert.equal(header.render(80).length, 3);
	await widget.show();
	assert.equal(header.render(80).length, 1);
	widget.dispose();
});

test("short terminals, occupied input docks and unknown layouts stay collapsed", () => {
	for (const [height, other] of [
		[8, 0],
		[22, 15],
	]) {
		const setup = fixture("fullscreen", height, other);
		const widget = createRunningWidget(setup.ctx, () =>
			Array.from({ length: 12 }, (_, i) => ({
				id: String(i),
				nextRunAt: 5000,
			})),
		);
		widget.refresh();
		const header = setup.header;
		assert.ok(header);
		header.render(80);
		header.handleMouse?.(click);
		assert.equal(header.render(80).length, 1);
		widget.dispose();
	}
	const setup = fixture("fullscreen");
	setup.tui.children = [];
	const widget = createRunningWidget(setup.ctx, () => [row]);
	widget.refresh();
	const header = setup.header;
	assert.ok(header);
	header.render(80);
	header.handleMouse?.(click);
	assert.equal(header.render(80).length, 1);
	widget.dispose();
});

test("summary spinner advances on its own interval and stops when hidden or disposed", (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
	const setup = fixture("fullscreen");
	const widget = createRunningWidget(setup.ctx, () => [row]);
	widget.refresh();
	const header = setup.header;
	assert.ok(header);
	assert.match(header.render(80)[0] ?? "", /\u25D3 Loop · 1 scheduled/);
	t.mock.timers.tick(600);
	assert.match(header.render(80)[0] ?? "", /\u25D1 Loop · 1 scheduled/);
	t.mock.timers.tick(1200);
	assert.match(header.render(80)[0] ?? "", /\u25D0 Loop · 1 scheduled/);
	widget.setVisible(false);
	const stopped = setup.renders;
	t.mock.timers.tick(3000);
	assert.equal(setup.renders, stopped);
	widget.dispose();
});

test("legacy never expands, including the old keyboard command", async () => {
	const setup = fixture("regular");
	const widget = createRunningWidget(setup.ctx, () => [row]);
	widget.refresh();
	assert.equal(setup.header?.handleMouse, undefined);
	await widget.show();
	assert.equal(setup.header?.render(80).length, 1);
	widget.dispose();
});

test("countdown ticks repaint cached data only, and stop while hidden or disposed", (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
	const setup = fixture("fullscreen");
	let reads = 0;
	const widget = createRunningWidget(setup.ctx, () => {
		reads++;
		return [{ id: "future", nextRunAt: 11000 }];
	});
	widget.refresh();
	const header = setup.header;
	assert.ok(header);
	header.render(80);
	header.handleMouse?.(click);
	assert.match(header.render(80)[1] ?? "", /10s/);
	const initialReads = reads;
	const initialRenders = setup.renders;
	t.mock.timers.tick(1000);
	assert.ok(setup.renders > initialRenders);
	assert.equal(reads, initialReads);
	assert.match(header.render(80)[1] ?? "", /9s/);
	widget.setVisible(false);
	const stopped = setup.renders;
	t.mock.timers.tick(5000);
	assert.equal(setup.renders, stopped);
	widget.dispose();
});

test("invalid context and failing diagnostics do not escape widget operations", async () => {
	const ctx = {
		get hasUI() {
			throw new Error("invalid context");
		},
		ui: {
			notify() {
				throw new Error("invalid UI");
			},
		},
	} as unknown as ExtensionContext;
	const widget = createRunningWidget(ctx, () => [row]);
	assert.doesNotThrow(() => widget.refresh());
	await assert.doesNotReject(widget.show());
	assert.doesNotThrow(() => widget.dispose());
});
