import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	buildTaskWidgetLines,
	normalizeTaskDisplayText,
	sortTasksForDisplay,
	TaskWidgetComponent,
} from "../tools/task-display.js";
import type { Task } from "../tools/task-types.js";

const timestamp = Date.parse("2026-01-01T00:00:00.000Z");

function task(id: number, status: Task["status"], text = `task ${id}`, blockedBy: number[] = []): Task {
	return {
		id,
		text,
		status,
		blocks: [],
		blockedBy,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

describe("task widget display", () => {
	it("keeps unfinished groups ascending and terminal groups descending", () => {
		const tasks = [
			task(1, "expired"),
			task(8, "done"),
			task(4, "pending", "blocked", [2]),
			task(6, "pending"),
			task(9, "expired"),
			task(2, "in_progress"),
			task(5, "done"),
			task(3, "pending"),
		];

		assert.deepEqual(
			sortTasksForDisplay(tasks).map((candidate) => candidate.id),
			[2, 3, 6, 4, 8, 5, 9, 1],
		);
		assert.deepEqual(
			buildTaskWidgetLines(tasks)
				.slice(1)
				.map((line) => Number(line.match(/#(\d+)/)?.[1])),
			[2, 3, 6, 4, 8, 5, 9, 1],
		);
	});

	it("normalizes whitespace and truncates every rendered row to terminal display width", () => {
		const originalText = "first\r\nsecond\t第三段非常非常长";
		const source = task(1, "in_progress", originalText);
		const lines = new TaskWidgetComponent([source]).render(30);

		assert.equal(normalizeTaskDisplayText(originalText), "first second 第三段非常非常长");
		assert.ok(lines[1]?.includes("first second"));
		assert.ok(lines[1]?.includes("…"));
		assert.ok(lines.every((line) => !line.includes("\n") && !line.includes("\r")));
		assert.ok(lines.every((line) => visibleWidth(line) <= 30));
	});

	it("shows ten tasks plus an overflow row", () => {
		const lines = buildTaskWidgetLines(
			Array.from({ length: 11 }, (_, index) => task(index + 1, "in_progress")),
		);

		assert.equal(lines.length, 12);
		assert.deepEqual(
			lines.slice(1, 11).map((line) => Number(line.match(/#(\d+)/)?.[1])),
			[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
		);
		assert.equal(lines[11], "  ... 1 more");
	});

	it("does not add an ellipsis when every row fits", () => {
		const lines = new TaskWidgetComponent([task(1, "in_progress", "short")]).render(80);

		assert.ok(lines.every((line) => !line.includes("…")));
	});

	it("reserves width for at most three blockers before truncating task text", () => {
		const tasks = [
			task(1, "pending", "a blocked task with a deliberately long description", [2, 3, 4, 5, 6, 7]),
			task(2, "done"),
			task(3, "expired"),
			task(4, "pending"),
			task(5, "pending"),
			task(6, "pending"),
			task(7, "pending"),
		];
		const line = new TaskWidgetComponent(tasks).render(34).find((candidate) => candidate.includes("○ #1"));
		const narrowLine = new TaskWidgetComponent(tasks).render(8).find((candidate) => candidate.includes("←"));

		assert.ok(line?.endsWith(" ← #4,#5,#6,…"));
		assert.ok(line?.includes("…"));
		assert.ok(!line?.includes("deliberately long description"));
		assert.ok(visibleWidth(line ?? "") <= 34);
		assert.ok(narrowLine?.includes("←"));
		assert.ok(!narrowLine?.includes("#1"));
		assert.ok(visibleWidth(narrowLine ?? "") <= 8);
	});

	it("normalizes expiration reasons without mutating persisted task text", () => {
		const source = task(1, "expired", "line one\nline two\tline three");
		source.expireReason = "reason\ncontinued";
		const original = structuredClone(source);
		const lines = buildTaskWidgetLines([source]);

		new TaskWidgetComponent([source]).render(16);

		assert.ok(lines[1]?.includes("[reason continued]"));
		assert.doesNotMatch(lines[1] ?? "", /[\r\n]/);
		assert.deepEqual(source, original);
	});
});
