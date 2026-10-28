import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ExtensionAPI,
	MessageRenderer,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { TaskRun } from "../src/script-tasks/task-spec.js";
import { registerTaskRunRenderer } from "../src/task-run-renderer.js";

function fixture() {
	let renderer: MessageRenderer<TaskRun> | undefined;
	const pi = {
		registerMessageRenderer: (
			_type: string,
			callback: MessageRenderer<TaskRun>,
		) => {
			renderer = callback;
		},
	} as unknown as ExtensionAPI;
	registerTaskRunRenderer(pi);
	assert.ok(renderer);
	const render = renderer;
	const theme = {
		bg: (_color: string, text: string) => text,
	} as unknown as Theme;
	return (
		message: Parameters<typeof render>[0],
		expanded = false,
		outputPad = 1,
	) => {
		const component = render(message, { expanded, outputPad }, theme);
		assert.ok(component);
		return component;
	};
}
function message(id = "card-one") {
	const details: TaskRun = {
		wakeUpId: id,
		results: [],
		successCount: 0,
		shouldWake: true,
		completedAt: 1793172000000,
		content: `MODEL_BODY_${id}\n<script="/test", exit-code="0">\nresult\n</script>`,
	};
	return {
		role: "custom" as const,
		customType: "loop-task-run",
		content: details.content,
		display: true,
		details,
		timestamp: 1,
	};
}
function mouse(
	component: Component,
	y: number,
	button: TuiMouseEvent["button"] = "left",
	width = 100,
	type: TuiMouseEvent["type"] = "click",
) {
	const lines = component.render(width);
	return component.handleMouse?.({
		type,
		button,
		x: 3,
		y,
		screenX: 3,
		screenY: y,
		width,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
	});
}
function text(component: Component, width = 100) {
	return component.render(width).join("\n");
}

test("left-click on the card toggles the exact model body; other mouse input does not", () => {
	const render = fixture();
	const entry = message();
	const card = render(entry);
	assert.ok(!text(card).includes("MODEL_BODY"));
	assert.equal(mouse(card, 1, "right")?.handled, undefined);
	assert.equal(mouse(card, 1, "left", 100, "wheel")?.handled, undefined);
	assert.equal(mouse(card, 1)?.handled, true);
	const expanded = card
		.render(100)
		.map((line) => line.trim())
		.join("\n");
	assert.ok(expanded.includes(entry.details.content));
	assert.equal(mouse(card, 2)?.handled, true);
	assert.ok(!text(card).includes("MODEL_BODY"));
	assert.equal(mouse(card, 1)?.handled, true);
	assert.ok(text(card).includes("MODEL_BODY"));
	assert.equal(mouse(card, 0)?.handled, true);
	assert.ok(!text(card).includes("MODEL_BODY"));
});

test("per-message expansion survives host rebuild and padding changes", () => {
	const render = fixture();
	const entry = message();
	const card = render(entry);
	mouse(card, 1);
	assert.ok(text(render(entry)).includes("MODEL_BODY"));
	assert.ok(text(render(entry, false, 3)).includes("MODEL_BODY"));
});

test("global Expand transitions still control the message", () => {
	const render = fixture();
	const entry = message();
	assert.ok(text(render(entry, true)).includes("MODEL_BODY"));
	const collapsed = render(entry, false);
	assert.ok(!text(collapsed).includes("MODEL_BODY"));
	mouse(collapsed, 1);
	assert.ok(text(render(entry, false)).includes("MODEL_BODY"));
	assert.ok(text(render(entry, true)).includes("MODEL_BODY"));
	assert.ok(!text(render(entry, false)).includes("MODEL_BODY"));
});

test("message identities and extension instances do not share expansion state", () => {
	const first = fixture();
	const entry = message();
	mouse(first(entry), 1);
	assert.ok(text(first(entry)).includes("MODEL_BODY"));
	assert.ok(!text(first(message("card-two"))).includes("MODEL_BODY"));
	assert.ok(!text(fixture()(entry)).includes("MODEL_BODY"));
});

test("every wrapped title line remains clickable", () => {
	const render = fixture();
	const card = render(message("a-long-id-that-wraps-over-several-lines"));
	const collapsed = card.render(24);
	assert.ok(collapsed.length > 3);
	assert.equal(mouse(card, collapsed.length - 2, "left", 24)?.handled, true);
	assert.ok(text(card, 100).includes("MODEL_BODY"));
});
