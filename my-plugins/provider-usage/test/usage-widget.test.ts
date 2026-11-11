import assert from "node:assert/strict";
import test from "node:test";
import type { UsageScheduler } from "../src/controller-contract.js";
import { createUsageQueryWidget } from "../src/usage-widget.js";

interface Painted {
	key: string;
	content: string[] | undefined;
}

function fakeScheduler() {
	const timers: Array<{ cleared: boolean; run(): void }> = [];
	const scheduler: UsageScheduler = {
		now: () => 0,
		after: (_delayMs, callback) => {
			const timer = { cleared: false, run: () => callback() };
			timers.push(timer);
			return { clear: () => (timer.cleared = true) };
		},
	};
	return {
		scheduler,
		pending: () => timers.filter((timer) => !timer.cleared),
		flushOne: () => {
			const timer = timers.find((entry) => !entry.cleared);
			if (!timer) throw new Error("no pending timer");
			timer.cleared = true;
			timer.run();
		},
	};
}

function painter() {
	const paints: Painted[] = [];
	return { paints, paint: (key: string, content: string[] | undefined) => paints.push({ key, content }) };
}

test("animates frames while a query is active and clears when it ends", () => {
	const { scheduler, flushOne, pending } = fakeScheduler();
	const { paints, paint } = painter();
	const widget = createUsageQueryWidget(paint, scheduler, ["a", "b", "c"], 100);

	widget.begin("Querying claude-code usage…");
	assert.deepEqual(paints.at(-1), { key: "provider-usage:query", content: ["a Querying claude-code usage…"] });
	flushOne();
	assert.deepEqual(paints.at(-1)?.content, ["b Querying claude-code usage…"]);
	flushOne();
	assert.deepEqual(paints.at(-1)?.content, ["c Querying claude-code usage…"]);
	flushOne();
	assert.deepEqual(paints.at(-1)?.content, ["a Querying claude-code usage…"]);

	widget.end();
	assert.deepEqual(paints.at(-1), { key: "provider-usage:query", content: undefined });
	assert.equal(pending().length, 0);
});

test("refcounts concurrent queries: the widget stays until the last one ends", () => {
	const { scheduler, flushOne } = fakeScheduler();
	const { paints, paint } = painter();
	const widget = createUsageQueryWidget(paint, scheduler, ["a", "b"], 100);

	widget.begin("first");
	widget.begin("second");
	assert.deepEqual(paints.at(-1)?.content, ["a second"]);
	flushOne();
	assert.deepEqual(paints.at(-1)?.content, ["b second"]);

	widget.end();
	flushOne();
	assert.deepEqual(paints.at(-1)?.content, ["a second"]);

	widget.end();
	assert.deepEqual(paints.at(-1), { key: "provider-usage:query", content: undefined });
	widget.end();
	assert.equal(paints.at(-1)?.content, undefined);
});

test("clear force-stops the animation and extra end calls stay inert", () => {
	const { scheduler } = fakeScheduler();
	const { paints, paint } = painter();
	const widget = createUsageQueryWidget(paint, scheduler, ["a"], 100);

	widget.begin("x");
	widget.clear();
	assert.deepEqual(paints.at(-1), { key: "provider-usage:query", content: undefined });
	widget.end();
	assert.equal(paints.length, 2);
});

test("an empty frame list draws the label once without scheduling ticks", () => {
	const { scheduler, pending } = fakeScheduler();
	const { paints, paint } = painter();
	const widget = createUsageQueryWidget(paint, scheduler, [], 100);

	widget.begin("solo");
	assert.deepEqual(paints.at(-1)?.content, [" solo"]);
	assert.equal(pending().length, 0);
	widget.end();
	assert.equal(paints.at(-1)?.content, undefined);
});
