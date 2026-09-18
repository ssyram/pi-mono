import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { assistant, user } from "./compaction-reference-fixtures.js";
import {
	completedResponse,
	completionCalls,
	resetCompletion,
} from "./custom-compaction-runtime-completion.js";
import {
	createHandler,
	runtimeEvent,
} from "./custom-compaction-runtime-fixtures.js";
import { providerCallCount } from "./prepare-compaction-request-provider-guard.js";

afterEach(() => {
	assert.equal(providerCallCount, 0);
	mock.restoreAll();
});

describe("registered custom compaction fallback", () => {
	it("rejects blank, non-text-only, terminator-only and empty-expanded output before file suffix", async () => {
		mock.method(console, "error", () => {});
		for (const content of [
			[],
			[{ type: "thinking" as const, thinking: "not summary" }],
			...[" \r\n", "@!@", "@!1[0:0]@"].map((text) => [
				{ type: "text" as const, text },
			]),
		]) {
			resetCompletion(completedResponse(content));
			const harness = createHandler();
			const result = await harness.run(
				runtimeEvent([
					user("source"),
					assistant([
						{
							type: "toolCall",
							id: "one",
							name: "edit",
							arguments: { path: "file" },
						},
					]),
				]),
			);
			assert.equal(result, undefined);
			assert.equal(completionCalls.length, 1);
			assert.deepEqual(harness.statuses, [
				"⚡ Compacting (oh-my-pi)...",
				undefined,
			]);
		}
	});

	it("preserves expanded text beyond the model generation allowance", async () => {
		const source = "x".repeat(40000);
		const event = runtimeEvent([user(source)]);
		event.preparation.settings.reserveTokens = 10;
		resetCompletion(completedResponse([{ type: "text", text: "@!1@" }]));
		const harness = createHandler();
		assert.equal((await harness.run(event))?.compaction?.summary, source);
		assert.equal(completionCalls.length, 1);
		assert.equal(completionCalls[0][2]?.maxTokens, 8);
		assert.equal(harness.statuses.at(-1), undefined);
	});

	it("preserves no-model, auth-denied and auth-throw fallback without any model call", async () => {
		mock.method(console, "error", () => {});
		for (const options of [
			{ model: null },
			{ auth: { ok: false as const, error: "denied" } },
			{ auth: new Error("auth failed") },
		]) {
			resetCompletion(completedResponse([{ type: "text", text: "unused" }]));
			const harness = createHandler(options);
			assert.equal(
				await harness.run(runtimeEvent([user("source")])),
				undefined,
			);
			assert.equal(completionCalls.length, 0);
			assert.equal(harness.authModels.length, options.model === null ? 0 : 1);
			assert.equal(harness.taskReads, 0);
			assert.deepEqual(harness.statuses, [
				"⚡ Compacting (oh-my-pi)...",
				undefined,
			]);
		}
	});

	it("preserves thrown completion and aborted completion fallback with status cleanup", async () => {
		mock.method(console, "error", () => {});
		for (const aborted of [false, true]) {
			resetCompletion(new Error("controlled completion failure"));
			const event = runtimeEvent([user("source")]);
			if (aborted) event.signal = AbortSignal.abort();
			const harness = createHandler();
			assert.equal(await harness.run(event), undefined);
			assert.equal(completionCalls.length, 1);
			assert.equal(completionCalls[0][2]?.signal, event.signal);
			assert.equal(harness.taskReads, 1);
			assert.deepEqual(harness.statuses, [
				"⚡ Compacting (oh-my-pi)...",
				undefined,
			]);
		}
	});

	it("catches task-preparation errors before calling the model", async () => {
		mock.method(console, "error", () => {});
		resetCompletion(completedResponse([{ type: "text", text: "unused" }]));
		const harness = createHandler({
			readTasks: () => {
				throw new Error("controlled task error");
			},
		});
		assert.equal(await harness.run(runtimeEvent([user("source")])), undefined);
		assert.equal(completionCalls.length, 0);
		assert.deepEqual(harness.statuses, [
			"⚡ Compacting (oh-my-pi)...",
			undefined,
		]);
	});

	it("contains status-setting failures at startup, successful cleanup and failed cleanup", async () => {
		mock.method(console, "error", () => {});
		resetCompletion(completedResponse([{ type: "text", text: "@!1@" }]));
		const startup = createHandler({ statusFailure: "start" });
		assert.equal(await startup.run(runtimeEvent([user("source")])), undefined);
		assert.equal(completionCalls.length, 0);
		assert.equal(startup.authModels.length, 0);
		assert.deepEqual(startup.statuses, [
			"⚡ Compacting (oh-my-pi)...",
			undefined,
		]);
		const success = createHandler({ statusFailure: "clear" });
		assert.equal(
			(await success.run(runtimeEvent([user("source")])))?.compaction?.summary,
			"source",
		);
		assert.deepEqual(success.statuses, [
			"⚡ Compacting (oh-my-pi)...",
			undefined,
		]);
		resetCompletion(new Error("controlled failure"));
		const failed = createHandler({ statusFailure: "clear" });
		assert.equal(await failed.run(runtimeEvent([user("source")])), undefined);
		assert.deepEqual(failed.statuses, [
			"⚡ Compacting (oh-my-pi)...",
			undefined,
		]);
	});
});
