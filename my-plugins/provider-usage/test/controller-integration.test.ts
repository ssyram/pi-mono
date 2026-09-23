import assert from "node:assert/strict";
import test from "node:test";
import { createController } from "../src/create-controller.js";
import type { ControllerContext, UsageQueryRunner, UsageScheduler, UsageTimer } from "../src/controller-contract.js";
import type { QueryResult, UsageModel } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

class ManualScheduler implements UsageScheduler {
	private time = 0;
	private nextId = 0;
	private timers = new Map<number, { due: number; callback: () => void; cleared: boolean }>();

	now(): number {
		return this.time;
	}

	after(delayMs: number, callback: () => void): UsageTimer {
		const id = this.nextId;
		this.nextId += 1;
		this.timers.set(id, { due: this.time + delayMs, callback, cleared: false });
		return {
			clear: () => {
				const timer = this.timers.get(id);
				if (timer) timer.cleared = true;
			},
		};
	}

	advance(milliseconds: number): void {
		this.time += milliseconds;
		while (true) {
			const next = Array.from(this.timers.entries())
				.filter(([, timer]) => !timer.cleared && timer.due <= this.time)
				.sort(([, left], [, right]) => left.due - right.due)[0];
			if (!next) return;
			this.timers.delete(next[0]);
			next[1].callback();
		}
	}
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	if (!resolvePromise) throw new Error("promise resolver should exist");
	return { promise, resolve: resolvePromise };
}

async function settle(): Promise<void> {
	for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

function controllerContext(scheduler: UsageScheduler, query: UsageQueryRunner): ControllerContext {
	return {
		sessionManager: {
			getSessionId: () => "session-1",
			getEntries: () => [],
			getCwd: () => "/tmp/project",
			getSessionName: () => undefined,
		},
		modelRegistry: {
			getProvider: () => undefined,
			getAll: () => [],
			getAvailable: () => [],
			getApiKeyAndHeaders: async () => ({ ok: false }),
			isUsingOAuth: () => false,
		},
		getContextUsage: () => ({ contextWindow: 128000, percent: 1 }),
		setFooter: () => {},
		scheduler,
		query,
	};
}

function queryQueue(): { query: UsageQueryRunner; jobs: Deferred<QueryResult>[]; signals: AbortSignal[] } {
	const jobs: Deferred<QueryResult>[] = [];
	const signals: AbortSignal[] = [];
	const query: UsageQueryRunner = (_selection, _route, _registry, signal) => {
		const job = deferred<QueryResult>();
		jobs.push(job);
		signals.push(signal);
		return job.promise;
	};
	return { query, jobs, signals };
}

function available(text: string): QueryResult {
	return { kind: "available", text, compact: text };
}

test("keeps one physical job while model changes and drops late old-model results", async () => {
	const scheduler = new ManualScheduler();
	const queued = queryQueue();
	const codex = makeModel({ provider: "first", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" });
	const zai = makeModel({ provider: "second", api: "openai-completions", baseUrl: "https://api.z.ai/api/coding/paas/v4" });
	const controller = createController(controllerContext(scheduler, queued.query), codex);
	assert.equal(queued.jobs.length, 1);
	controller.requestRefresh(codex);
	controller.requestRefresh(codex);
	assert.equal(queued.jobs.length, 1);
	controller.requestRefresh(zai);
	assert.equal(queued.signals[0]?.aborted, true);
	assert.equal(queued.jobs.length, 1);
	queued.jobs[0]?.resolve(available("old"));
	await settle();
	assert.equal(queued.jobs.length, 2);
	assert.equal(controller.getFooterSnapshot().display.kind, "loading");
	queued.jobs[1]?.resolve(available("new"));
	await settle();
	assert.deepEqual(controller.getFooterSnapshot().display, {
		kind: "ready",
		selection: {
			sessionId: "session-1",
			model: zai,
			modelId: zai.id,
			providerId: "second",
			api: "openai-completions",
			endpoint: "https://api.z.ai/api/coding/paas/v4",
		},
		result: available("new"),
	});
});

test("reselecting the same model invalidates an in-flight account query", async () => {
	const scheduler = new ManualScheduler();
	const queued = queryQueue();
	const model = makeModel({ provider: "codex-002", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" });
	const controller = createController(controllerContext(scheduler, queued.query), model);
	controller.requestRefresh(model, true);
	assert.equal(queued.signals[0]?.aborted, true);
	assert.equal(queued.jobs.length, 1);
	queued.jobs[0]?.resolve(available("old account"));
	await settle();
	assert.equal(queued.jobs.length, 2);
	queued.jobs[1]?.resolve(available("current account"));
	await settle();
	const display = controller.getFooterSnapshot().display;
	assert.equal(display.kind, "ready");
	if (display.kind !== "ready") throw new Error("expected current result");
	assert.deepEqual(display.result, available("current account"));
	controller.dispose();
});

test("publishes timeout, drops late completion, and rate-limits a trailing refresh", async () => {
	const scheduler = new ManualScheduler();
	const queued = queryQueue();
	const model = makeModel({ provider: "codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" });
	const controller = createController(controllerContext(scheduler, queued.query), model);
	assert.equal(queued.jobs.length, 1);
	scheduler.advance(15_000);
	assert.equal(queued.signals[0]?.aborted, true);
	const timedOut = controller.getFooterSnapshot().display;
	assert.equal(timedOut.kind, "ready");
	if (timedOut.kind !== "ready") throw new Error("timeout should be ready state");
	assert.deepEqual(timedOut.result, { kind: "error", code: "timeout" });
	queued.jobs[0]?.resolve(available("late"));
	await settle();
	const afterLateResult = controller.getFooterSnapshot().display;
	assert.equal(afterLateResult.kind, "ready");
	if (afterLateResult.kind !== "ready") throw new Error("late result should not change timeout state");
	assert.deepEqual(afterLateResult.result, { kind: "error", code: "timeout" });
	controller.requestRefresh(model);
	assert.equal(queued.jobs.length, 1);
	scheduler.advance(45_000);
	assert.equal(queued.jobs.length, 2);
	queued.jobs[1]?.resolve(available("fresh"));
	await settle();
	const freshResult = controller.getFooterSnapshot().display;
	assert.equal(freshResult.kind, "ready");
	if (freshResult.kind !== "ready") throw new Error("fresh result should be ready state");
	assert.deepEqual(freshResult.result, available("fresh"));
	controller.dispose();
	controller.requestRefresh(model);
	assert.equal(queued.jobs.length, 2);
});

