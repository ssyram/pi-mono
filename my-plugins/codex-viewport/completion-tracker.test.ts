import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompletionTracker } from "./completion-tracker.js";

interface TestComponent {
	name: string;
}

function component(name: string): TestComponent {
	return { name };
}

describe("CompletionTracker", () => {
	it("releases parallel tools only through the contiguous completed frontier", () => {
		const tracker = new CompletionTracker<TestComponent>();
		const assistant = component("assistant");
		const first = component("first");
		const second = component("second");

		tracker.beginAssistant();
		tracker.ensureTool("first");
		tracker.ensureTool("second");
		tracker.attachNextAssistant(assistant);
		tracker.attachTool("first", first);
		tracker.attachTool("second", second);
		tracker.completeAssistant();
		assert.deepEqual(tracker.releaseCompletedPrefix(), [assistant]);

		tracker.completeTool("second");
		assert.deepEqual(tracker.releaseCompletedPrefix(), []);
		tracker.completeTool("first");
		assert.deepEqual(tracker.releaseCompletedPrefix(), [first, second]);
	});

	it("deduplicates tool registration and completion", () => {
		const tracker = new CompletionTracker<TestComponent>();
		const tool = component("tool");
		tracker.ensureTool("same");
		tracker.ensureTool("same");
		assert.equal(tracker.attachTool("same", tool), true);
		assert.equal(tracker.attachTool("same", component("duplicate")), false);
		tracker.completeTool("same");
		assert.deepEqual(tracker.releaseCompletedPrefix(), [tool]);
	});

	it("releases generated completion permutations only through the source-order frontier", () => {
		for (let size = 1; size <= 8; size++) {
			for (let seed = 0; seed < 32; seed++) {
				const tracker = new CompletionTracker<TestComponent>();
				const tools = Array.from({ length: size }, (_, index) => component(`tool-${index}`));
				for (let index = 0; index < size; index++) {
					tracker.ensureTool(String(index));
					tracker.attachTool(String(index), tools[index]);
				}
				const order = Array.from({ length: size }, (_, index) => index);
				let value = seed + 1;
				for (let index = size - 1; index > 0; index--) {
					value = (value * 1103515245 + 12345) >>> 0;
					const swap = value % (index + 1);
					[order[index], order[swap]] = [order[swap], order[index]];
				}
				const completed = new Set<number>();
				let released = 0;
				for (const index of order) {
					completed.add(index);
					tracker.completeTool(String(index));
					const previousReleased = released;
					while (completed.has(released)) released++;
					assert.deepEqual(tracker.releaseCompletedPrefix(), tools.slice(previousReleased, released));
				}
			}
		}
	});

	it("finishes pending tools on aborted assistant completion", () => {
		const tracker = new CompletionTracker<TestComponent>();
		const assistant = component("assistant");
		const tool = component("tool");
		tracker.beginAssistant();
		tracker.ensureTool("tool");
		tracker.attachNextAssistant(assistant);
		tracker.attachTool("tool", tool);
		tracker.completeAssistant(true);
		assert.deepEqual(tracker.releaseCompletedPrefix(), [assistant, tool]);
	});
});
