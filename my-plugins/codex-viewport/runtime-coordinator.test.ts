import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RuntimeCoordinator } from "./runtime-coordinator.js";
import { createTestTuiContext } from "./test-tui-context.js";
import { tuiInternals } from "./tui-internals.js";

describe("RuntimeCoordinator", () => {
	it("patches only between startRun and finishRun", () => {
		const test = createTestTuiContext();
		const runtime = new RuntimeCoordinator();
		runtime.capture(test.ctx);
		assert.equal(Object.hasOwn(test.tui, "doRender"), false);
		runtime.startRun();
		assert.equal(runtime.isManaged(), true);
		assert.equal(Object.hasOwn(test.tui, "doRender"), true);
		runtime.finishRun();
		assert.equal(runtime.isManaged(), false);
		assert.equal(Object.hasOwn(test.tui, "doRender"), false);
		runtime.startRun();
		assert.equal(runtime.isManaged(), true);
		runtime.finishRun();
		assert.equal(Object.hasOwn(test.tui, "doRender"), false);
		assert.deepEqual(test.notifications(), []);
	});

	it("refuses to adopt an already active run after reload", () => {
		const test = createTestTuiContext();
		const runtime = new RuntimeCoordinator();
		test.setIdle(false);
		runtime.capture(test.ctx);
		runtime.startRun();
		assert.equal(runtime.isManaged(), false);
		assert.equal(Object.hasOwn(test.tui, "doRender"), false);
		assert.match(test.notifications()[0] ?? "", /disabled.*already active/);
		runtime.finishRun();
		assert.equal(Object.hasOwn(test.tui, "doRender"), false);
	});

	it("reports an existing instance renderer instead of silently falling back", () => {
		const test = createTestTuiContext();
		const runtime = new RuntimeCoordinator();
		runtime.capture(test.ctx);
		const foreignRenderer = () => {};
		const internals = tuiInternals(test.tui);
		internals.doRender = foreignRenderer;
		runtime.startRun();
		assert.equal(runtime.isManaged(), false);
		assert.equal(internals.doRender, foreignRenderer);
		assert.match(test.notifications()[0] ?? "", /another extension already owns/);
	});

	it("shutdown is idempotent and leaves native methods", () => {
		const test = createTestTuiContext();
		const runtime = new RuntimeCoordinator();
		runtime.capture(test.ctx);
		runtime.startRun();
		runtime.shutdown();
		runtime.shutdown();
		assert.equal(runtime.isManaged(), false);
		assert.equal(Object.hasOwn(test.tui, "doRender"), false);
	});
});
