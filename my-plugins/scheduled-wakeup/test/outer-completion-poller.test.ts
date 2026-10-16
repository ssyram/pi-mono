import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { DuePoller, type TimerHandle } from "../src/v2/due-poller.js";
import { createLoopCommandAutocompleteProvider } from "../src/v2/loop-command-autocomplete.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";
import { createBoundaryFixture } from "./outer-boundary-fixture.js";

const source = {
	activeIds: () => ["session:one"],
	sharedDefinitionIds: () => [],
};

test("async completion rejection is caught, and the next call remains usable", async () => {
	let fail = true;
	const current: AutocompleteProvider = {
		getSuggestions: async () => {
			if (fail) throw new Error("ENOENT");
			return { items: [], prefix: "" };
		},
		applyCompletion: (lines, cursorLine, cursorCol) => ({
			lines,
			cursorLine,
			cursorCol,
		}),
	};
	const provider = createLoopCommandAutocompleteProvider(current, source);
	const options = { signal: new AbortController().signal };
	assert.equal(await provider.getSuggestions(["other"], 0, 5, options), null);
	fail = false;
	assert.deepEqual(await provider.getSuggestions(["other"], 0, 5, options), {
		items: [],
		prefix: "",
	});
});

test("completion source and sync delegation failures preserve input without escaping", async () => {
	const current = {
		getSuggestions: async () => null,
		applyCompletion: () => {
			throw new Error("apply failed");
		},
		shouldTriggerFileCompletion: () => {
			throw new Error("trigger failed");
		},
	};
	const provider = createLoopCommandAutocompleteProvider(current, {
		...source,
		activeIds: () => {
			throw new Error("unavailable");
		},
	});
	assert.equal(
		await provider.getSuggestions(["/loop stop "], 0, 11, {
			signal: new AbortController().signal,
		}),
		null,
	);
	const lines = ["ordinary"];
	assert.deepEqual(
		provider.applyCompletion(lines, 0, 8, { value: "x", label: "x" }, ""),
		{ lines, cursorLine: 0, cursorCol: 8 },
	);
	assert.equal(provider.shouldTriggerFileCompletion?.(lines, 0, 8), false);
});

test("timer re-arm failure stops polling and remains nothrow even if diagnostics fail", (t) => {
	const setup = createBoundaryFixture(t);
	const entries: SessionEntryLike[] = [];
	let failRead = false;
	const core = new LoopV2Core({
		sessionId: "poller-failure",
		workspaceRoot: setup.cwd,
		globalRoot: setup.cwd,
		now: () => 1000,
		sessionEntries: {
			getBranch: () => {
				if (failRead) throw new Error("stale context");
				return entries;
			},
			appendEntry: (customType, data) =>
				entries.push({ type: "custom", customType, data }),
		},
	});
	core.createSessionTask({
		prompt: "later",
		schedule: { kind: "once", runAt: 2000 },
	});
	let handler: (() => void) | undefined;
	const handle: TimerHandle = {};
	const errors: unknown[] = [];
	const poller = new DuePoller({
		core,
		deliver: () => undefined,
		now: () => 1000,
		timers: {
			set: (fn) => {
				handler = fn;
				return handle;
			},
			clear: () => {
				handler = undefined;
			},
		},
		onError: (error) => {
			errors.push(error);
			throw new Error("diagnostic failed");
		},
	});
	poller.start();
	assert.ok(handler);
	failRead = true;
	assert.doesNotThrow(handler);
	assert.equal(poller.isRunning, false);
	assert.equal(poller.hasTimer, false);
	assert.equal(errors.length, 1);
	poller.dispose();
});

test("start failure cannot leave a running poller without a timer", (t) => {
	const setup = createBoundaryFixture(t);
	const core = new LoopV2Core({
		sessionId: "start-failure",
		workspaceRoot: setup.cwd,
		globalRoot: setup.cwd,
		sessionEntries: { getBranch: () => [], appendEntry: () => undefined },
	});
	const poller = new DuePoller({
		core,
		deliver: () => undefined,
		now: () => {
			throw new Error("clock failed");
		},
	});
	assert.throws(() => poller.start(), /clock failed/);
	assert.equal(poller.isRunning, false);
	assert.equal(poller.hasTimer, false);
});
