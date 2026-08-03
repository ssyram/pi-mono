import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompletionTracker } from "./completion-tracker.js";

describe("CompletionTracker containment", () => {
	it("tracks an assistant without containing its native component", () => {
		const tracker = new CompletionTracker<object>();
		const assistant = {};
		tracker.beginAssistant();
		assert.equal(tracker.attachNextAssistant(assistant), true);
		assert.equal(tracker.contains(assistant), true);
		assert.equal(tracker.shouldContain(assistant), false);
		assert.deepEqual(tracker.components(), []);
		tracker.completeAssistant();
		assert.deepEqual(tracker.releaseCompletedPrefix(), [assistant]);
	});

	it("moves the current assistant into the contained component set", () => {
		const tracker = new CompletionTracker<object>();
		const assistant = {};
		tracker.beginAssistant();
		tracker.attachNextAssistant(assistant);
		tracker.containCurrentAssistant();
		assert.equal(tracker.shouldContain(assistant), true);
		assert.deepEqual(tracker.components(), [assistant]);
	});

	it("always contains tool components", () => {
		const tracker = new CompletionTracker<object>();
		const tool = {};
		tracker.ensureTool("call");
		tracker.attachTool("call", tool);
		assert.equal(tracker.shouldContain(tool), true);
		assert.deepEqual(tracker.components(), [tool]);
	});
});
