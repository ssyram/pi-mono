import assert from "node:assert/strict";
import test from "node:test";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { registerUsageAiMessageRenderer, USAGE_AI_MESSAGE_TYPE, type UsageAiMessageDetails } from "../src/usage-ai-message.js";

interface AiReportMessage {
	content: string;
	details?: UsageAiMessageDetails;
}

interface CapturedRenderer {
	customType: string;
	renderer: (message: AiReportMessage, options: { expanded: boolean }, theme: unknown) => unknown;
}

const theme = {
	fg: (_color: string, text: string) => text,
};

function register(): CapturedRenderer {
	const captured: CapturedRenderer[] = [];
	registerUsageAiMessageRenderer({
		registerMessageRenderer: (customType: string, renderer: unknown) => {
			captured.push({ customType, renderer: renderer as CapturedRenderer["renderer"] });
		},
	});
	return captured[0]!;
}

function message(overrides: Partial<AiReportMessage> = {}): AiReportMessage {
	return {
		content: "Provider usage snapshot:\nzai-001: 17%(5h) used",
		details: { collapsed: "zai-001:(17%(5h)), zai-002:(AUTH)" },
		...overrides,
	};
}

function click(): TuiMouseEvent {
	return { type: "click", button: "left", x: 0, y: 0, screenX: 0, screenY: 0, width: 40, height: 2, shift: false, alt: false, ctrl: false, meta: false } as unknown as TuiMouseEvent;
}

function visible(line: string): string {
	return line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
}

test("registers the renderer for the AI report message type", () => {
	const captured = register();
	assert.equal(captured.customType, USAGE_AI_MESSAGE_TYPE);
});

test("collapsed render shows label plus one truncated line, click expands to full content", () => {
	const { renderer } = register();
	const component = renderer(message(), { expanded: false }, theme) as Component;
	assert.ok(component);

	const collapsed = component.render(80).map(visible);
	assert.equal(collapsed.length, 2);
	assert.match(collapsed[0]!, /\[Provider Usage\]/);
	assert.equal(collapsed[1]!.trim(), "zai-001:(17%(5h)), zai-002:(AUTH)");

	const narrow = component.render(20).map(visible);
	assert.equal(narrow.length, 2);
	assert.ok(narrow[1]!.endsWith("..."), `expected ellipsis, got ${narrow[1]}`);

	assert.deepEqual(component.handleMouse?.(click()), { handled: true });
	const expandedLines = component.render(80).map(visible);
	assert.ok(expandedLines.length > 2);
	assert.match(expandedLines.join("\n"), /zai-001: 17%\(5h\) used/);

	component.handleMouse?.(click());
	assert.equal(component.render(80).length, 2);
});

test("external expand-all toggles follow global state without resetting later clicks", () => {
	const { renderer } = register();
	const msg = message();
	const component = renderer(msg, { expanded: false }, theme) as Component;
	renderer(msg, { expanded: true }, theme);
	assert.ok(component.render(80).length > 2, "expand-all opens the message");
	renderer(msg, { expanded: true }, theme);
	component.handleMouse?.(click());
	assert.equal(component.render(80).length, 2, "click collapses even while expand-all is on");
	renderer(msg, { expanded: true }, theme);
	component.render(80);
	assert.equal(component.render(80).length, 2, "same external state does not override the click");
});

test("messages without details fall back to default rendering", () => {
	const { renderer } = register();
	const msg = message();
	delete msg.details;
	assert.equal(renderer(msg, { expanded: false }, theme), undefined);
});
