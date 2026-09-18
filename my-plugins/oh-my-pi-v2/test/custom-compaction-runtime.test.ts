import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { assistant, tool, user } from "./compaction-reference-fixtures.js";
import {
	completedResponse,
	completionCalls,
	resetCompletion,
} from "./custom-compaction-runtime-completion.js";
import {
	createHandler,
	runtimeEvent,
	runtimeModel,
	sentPrompt,
} from "./custom-compaction-runtime-fixtures.js";
import { ordinaryPrompt } from "./prepare-compaction-request-fixtures.js";
import { providerCallCount } from "./prepare-compaction-request-provider-guard.js";

afterEach(() => assert.equal(providerCallCount, 0));

describe("registered custom compaction", () => {
	it("keeps no-source first/update OFF prompts and outputs byte-identical", async () => {
		for (const previous of [
			undefined,
			"\n\n<read-files>\nold\n</read-files>",
		]) {
			const event = runtimeEvent([tool("raw @!9@")], previous);
			event.customInstructions = "focus @!8@";
			const harness = createHandler({
				model: { ...runtimeModel, reasoning: false },
			});
			const draft = `@!99@ @|!99@ ${"x".repeat(10000)}`;
			resetCompletion(completedResponse([{ type: "text", text: draft }]));
			assert.equal((await harness.run(event))?.compaction?.summary, draft);
			assert.equal(sentPrompt(), ordinaryPrompt(event));
			assert.equal(completionCalls[0][2]?.reasoning, undefined);
			assert.equal(harness.statuses.at(-1), undefined);
		}
	});

	it("keeps references enabled independently of model contextWindow", async () => {
		const event = runtimeEvent([user("source")], "old summary");
		const harness = createHandler({
			model: { ...runtimeModel, contextWindow: 0 },
		});
		resetCompletion(completedResponse([{ type: "text", text: "@!1@ @|!99@" }]));
		assert.equal(
			(await harness.run(event))?.compaction?.summary,
			"old summary @!99@",
		);
		assert.match(sentPrompt(), /@!1@old summary@!@/);
		assert.match(sentPrompt(), /\[User\]: @!2@source@!@/);
	});

	it("replaces malformed/unknown references without exposing internal IDs or throwing", async () => {
		const harness = createHandler();
		resetCompletion(
			completedResponse([
				{ type: "text", text: "@!999999@ @!bad@ @|!literal@ @!1@" },
			]),
		);
		assert.equal(
			(await harness.run(runtimeEvent([user("source")])))?.compaction?.summary,
			"(unresolved compaction reference) (unresolved compaction reference) @!literal@ source",
		);
		assert.equal(harness.statuses.at(-1), undefined);
	});

	it("runs two production-handler rounds with plain saved text and one unrescanned current file suffix", async () => {
		const harness = createHandler();
		const firstEvent = runtimeEvent([
			user("literal @!88@"),
			assistant([
				{
					type: "toolCall",
					id: "one",
					name: "edit",
					arguments: { path: "old@!99@" },
				},
			]),
		]);
		resetCompletion(completedResponse([{ type: "text", text: "@!1@" }]));
		const saved = (await harness.run(firstEvent))?.compaction;
		assert.ok(saved);
		assert.deepEqual(Object.keys(saved).sort(), [
			"firstKeptEntryId",
			"summary",
			"tokensBefore",
		]);
		assert.equal(
			saved.summary,
			"literal @!88@\n\n<modified-files>\nold@!99@\n</modified-files>",
		);
		const secondEvent = runtimeEvent(
			[
				user("new request"),
				assistant([
					{
						type: "toolCall",
						id: "two",
						name: "edit",
						arguments: { path: "new@!98@" },
					},
				]),
			],
			saved.summary,
		);
		resetCompletion(completedResponse([{ type: "text", text: "@!1@\n@!2@" }]));
		const next = await harness.run(secondEvent);
		assert.match(sentPrompt(), /@!1@literal @\|!88@@!@\n\n<modified-files>/);
		assert.match(sentPrompt(), /\[User\]: @!2@new request@!@/);
		assert.equal(
			next?.compaction?.summary,
			"literal @!88@\nnew request\n\n<modified-files>\nnew@!98@\n</modified-files>",
		);
		assert.deepEqual(Object.keys(next?.compaction ?? {}).sort(), [
			"firstKeptEntryId",
			"summary",
			"tokensBefore",
		]);
		assert.equal(harness.taskReads, 2);
		assert.deepEqual(harness.statuses, [
			"⚡ Compacting (oh-my-pi)...",
			undefined,
			"⚡ Compacting (oh-my-pi)...",
			undefined,
		]);
	});
});
