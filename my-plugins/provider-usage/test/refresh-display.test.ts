import assert from "node:assert/strict";
import test from "node:test";
import { createController } from "../src/create-controller.js";
import type { ControllerContext, UsageScheduler } from "../src/controller-contract.js";
import { formatDisplayState } from "../src/footer-display.js";
import type { QueryResult } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

test("keeps the last successful value during a same-account refresh and clears it on account change", async () => {
	let now = 0;
	const timers: Array<{ at: number; run: () => void; active: boolean }> = [];
	const scheduler: UsageScheduler = {
		now: () => now,
		after(delay, callback) {
			const timer = { at: now + delay, run: callback, active: true };
			timers.push(timer);
			return { clear: () => { timer.active = false; } };
		},
	};
	const advance = (ms: number): void => {
		now += ms;
		for (const timer of [...timers]) {
			if (timer.active && timer.at <= now) {
				timer.active = false;
				timer.run();
			}
		}
	};
	const jobs: Array<(result: QueryResult) => void> = [];
	const context: ControllerContext = {
		sessionManager: { getSessionId: () => "session-1", getEntries: () => [], getCwd: () => "/tmp", getSessionName: () => undefined },
		modelRegistry: {
			getAll: () => [], getAvailable: () => [], getProvider: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }), isUsingOAuth: () => false,
		},
		getContextUsage: () => undefined,
		setFooter: () => {},
		scheduler,
		query: () => new Promise((resolve) => { jobs.push(resolve); }),
	};
	const model = makeModel({ provider: "codex-002", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" });
	const controller = createController(context, model);
	assert.equal(controller.getFooterSnapshot().display.kind, "loading");
	jobs[0]?.({ kind: "available", text: "已用 72%(week)", compact: "72%(week)" });
	await new Promise((resolve) => setImmediate(resolve));
	controller.requestRefresh(model);
	assert.equal(controller.getFooterSnapshot().display.kind, "ready");
	advance(60_000);
	assert.equal(jobs.length, 2);
	let display = controller.getFooterSnapshot().display;
	assert.equal(display.kind, "ready");
	if (display.kind !== "ready") throw new Error("expected last success");
	assert.equal(display.result.kind, "available");
	if (display.result.kind !== "available") throw new Error("expected quota");
	assert.equal(display.result.compact, "72%(week)");
	jobs[1]?.({ kind: "error", code: "network" });
	await new Promise((resolve) => setImmediate(resolve));
	display = controller.getFooterSnapshot().display;
	assert.equal(formatDisplayState(display), "(72%(week) (err))");
	controller.requestRefresh(model);
	advance(60_000);
	jobs[2]?.({ kind: "available", text: "已用 75%(week)", compact: "75%(week)" });
	await new Promise((resolve) => setImmediate(resolve));
	display = controller.getFooterSnapshot().display;
	if (display.kind !== "ready" || display.result.kind !== "available") throw new Error("expected fresh result");
	assert.equal(display.result.compact, "75%(week)");
	assert.equal(display.staleError, undefined);
	const next = makeModel({ provider: "zai", baseUrl: "https://api.z.ai/api/coding/paas/v4" });
	controller.requestRefresh(next);
	assert.equal(controller.getFooterSnapshot().display.kind, "loading");
	jobs[3]?.({ kind: "error", code: "network" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(formatDisplayState(controller.getFooterSnapshot().display), "(ERR)");
	controller.dispose();
});
