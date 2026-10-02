import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderTaskResult } from "../tools/task-renderers.js";
import { executeTaskRequest } from "../tools/task-system/execute.js";
import type { TaskDetails } from "../tools/task-types.js";
import { state, task, text } from "./task-system-fixtures.js";

const plainTheme = {
	fg: (_color: string, value: string) => value,
	bold: (value: string) => value,
} as Theme;
const collapsed = { expanded: false, isPartial: false };

function render(content: Array<{ type: string; text?: string; data?: string }>, details: unknown): string {
	return renderTaskResult(
		// biome-ignore lint/suspicious/noExplicitAny: test fixture
		{ content, details } as any,
		collapsed,
		plainTheme,
	)
		.render(200)
		.map((line) => line.trimEnd())
		.join("\n");
}

describe("task result rendering", () => {
	it("keeps AI content as #N done while the TUI shows #N done: desc", () => {
		const original = state(task(1, "in_progress"), task(2, "pending", [1]));
		const operation = executeTaskRequest(original, {
			action: "done",
			id: 1,
			startNext: 2,
		});
		assert.equal(text(operation), "#1 done\n#2 started");
		const rendered = render(operation.result.content, operation.result.details);
		assert.match(rendered, /#1 done: task 1/);
		assert.match(rendered, /#2 started: task 2/);
	});

	it("passes through partial prefixes and enriches handoff failure lines", () => {
		const original = state(task(1, "in_progress"), task(2, "pending", [3]), task(3, "pending"));
		const operation = executeTaskRequest(original, {
			action: "done",
			id: 1,
			startNext: 2,
		});
		const rendered = render(operation.result.content, operation.result.details);
		assert.match(rendered, /^Partially applied:$/m);
		assert.match(rendered, /#1 done: task 1/);
		assert.match(rendered, /#2 not started: task #2 is blocked by: #3: task 2/);
	});

	it("enriches created lines from add and leaves item-skip lines untouched", () => {
		const original = state();
		const operation = executeTaskRequest(original, {
			action: "add",
			tasks: [{ text: "fix login" }, { text: "  " }],
		});
		const rendered = render(operation.result.content, operation.result.details);
		assert.match(rendered, /#1 created: fix login/);
		assert.match(rendered, /^Item 2 skipped: text is required$/m);
	});

	it("falls back to raw content text when details has an unexpected shape", () => {
		const raw = render([{ type: "text", text: "#1 done" }], { other: true });
		assert.equal(raw, "#1 done");
	});

	it("renders errors and empty content without throwing", () => {
		assert.equal(
			render([{ type: "text", text: "Error: nope" }], {
				action: "start",
				tasks: [],
				nextId: 1,
				error: "nope",
			} satisfies TaskDetails),
			"Error: nope",
		);
		assert.equal(render([], undefined), "");
		assert.equal(render([{ type: "image", data: "x" }], undefined), "");
	});

	it("skips malformed task entries instead of crashing", () => {
		const details = {
			action: "done",
			tasks: [null, { id: 1, text: "task 1", status: "done", blocks: [], blockedBy: [] }, { id: "x" }],
			nextId: 2,
		};
		const rendered = render([{ type: "text", text: "#1 done\n#9 done" }], details);
		assert.match(rendered, /#1 done: task 1/);
		assert.match(rendered, /^#9 done$/m);
	});
});
