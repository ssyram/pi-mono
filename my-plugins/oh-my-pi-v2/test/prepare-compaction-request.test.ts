import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { BOULDER_RESUME_MESSAGE_TYPE } from "../hooks/boulder-resume-message.js";
import {
	buildCompactionPrompt,
	buildUpdateCompactionPrompt,
	COMPACTION_SYSTEM_PROMPT,
} from "../hooks/compaction-prompt.js";
import { buildCompactionReferenceInstructions } from "../hooks/compaction-reference-prompt.js";
import type { CompactionTaskStateReader } from "../hooks/compaction-task-context.js";
import { prepareCompactionRequest } from "../hooks/prepare-compaction-request.js";
import { assistant, tool, user } from "./compaction-reference-fixtures.js";
import {
	compactEvent,
	context,
	noTasks,
	ordinaryPrompt,
} from "./prepare-compaction-request-fixtures.js";
import { providerCallCount } from "./prepare-compaction-request-provider-guard.js";

afterEach(() => assert.equal(providerCallCount, 0));

describe("prepare compaction request", () => {
	it("keeps first/update no-source prompts and OFF output byte-identical", () => {
		for (const summary of [
			undefined,
			"\n\n<read-files>\nold@!9@\n</read-files>",
		]) {
			const event = compactEvent([tool("result @!99@"), user("")], summary);
			event.customInstructions = "literal @!99@";
			const request = prepareCompactionRequest(event, context, noTasks);
			assert.equal(request.prompt, ordinaryPrompt(event));
			assert.equal(request.maxTokens, Math.floor(0.8 * 1024));
			assert.equal(
				request.finalizeSummary(" @!99@ @|!9@ \n"),
				" @!99@ @|!9@ \n",
			);
			assert.equal(
				request.finalizeSummary("x".repeat(10000)),
				"x".repeat(10000),
			);
			assert.equal(request.finalizeSummary(" \r\n"), "");
		}
	});

	it("annotates large eligible input even with a small model generation allowance", () => {
		const source = "large source @!literal@\r\n ".repeat(10000);
		for (const summary of [undefined, "previous summary"]) {
			const event = compactEvent([user(source)], summary);
			event.preparation.settings.reserveTokens = 10;
			const request = prepareCompactionRequest(event, context, noTasks);
			const label = summary ? "@!2@" : "@!1@";
			assert.equal(request.maxTokens, Math.floor(0.8 * 10));
			assert.ok(
				request.prompt.includes(`[User]: ${label}large source @|!literal@`),
			);
			assert.notEqual(request.prompt, ordinaryPrompt(event));
			assert.equal(request.finalizeSummary(label), source);
			assert.ok(
				request.prompt.endsWith(
					`\n\n${buildCompactionReferenceInstructions()}`,
				),
			);
		}
	});

	it("filters once, reads tasks once, and uses the same eligible occurrence order", () => {
		const event = compactEvent([
			{
				role: "custom",
				customType: BOULDER_RESUME_MESSAGE_TYPE,
				content: "DROP",
				display: true,
				timestamp: 0,
			},
			user("one"),
			user("two"),
		]);
		let filters = 0;
		event.preparation.messagesToSummarize = new Proxy(
			event.preparation.messagesToSummarize,
			{
				get(target, key, receiver) {
					if (key === "filter") filters++;
					return Reflect.get(target, key, receiver);
				},
			},
		);
		let reads = 0;
		const readTasks: CompactionTaskStateReader = (received) => {
			assert.equal(received, context);
			reads++;
			return noTasks(received);
		};
		const request = prepareCompactionRequest(event, context, readTasks);
		assert.equal(filters, 1);
		assert.equal(reads, 1);
		assert.doesNotMatch(request.prompt, /DROP/);
		assert.match(
			request.prompt,
			/\[User\]: @!1@one@!@\n\n\[User\]: @!2@two@!@/,
		);
		assert.equal(request.finalizeSummary("@!2@@!1@"), "twoone");
		assert.equal(reads, 1);
	});

	it("escapes ordinary source, non-source, task and custom text without a catalog", () => {
		const event = compactEvent(
			[
				user("request @!90@"),
				assistant([{ type: "text", text: "answer @!91@" }]),
				tool("result @!92@"),
				{
					role: "custom",
					customType: "other",
					content: "custom @!93@",
					display: true,
					timestamp: 0,
				},
			],
			"summary @!94@\n\n<modified-files>\nold@!95@\n</modified-files>",
		);
		event.customInstructions = "focus @!96@";
		const task = {
			id: 1,
			text: "task @|!97@",
			status: "pending" as const,
			blocks: [],
			blockedBy: [],
			createdAt: 0,
			updatedAt: 0,
		};
		const request = prepareCompactionRequest(event, context, () => ({
			tasks: [task],
			actionableCount: 1,
			readyTasks: [task],
		}));
		for (let id = 90; id <= 96; id++)
			assert.ok(request.prompt.includes(`@|!${id}@`));
		assert.ok(request.prompt.includes("task @||!97@"));
		assert.match(request.prompt, /@!1@summary @\|!94@@!@\n\n<modified-files>/);
		assert.match(request.prompt, /\[User\]: @!2@request @\|!90@@!@/);
		assert.equal(request.finalizeSummary("@!2@ @|!96@"), "request @!90@ @!96@");
		assert.equal(request.prompt.split("request @|!90@").length, 2);
		assert.doesNotMatch(request.prompt, /old \/ potential|<current_history>/);
	});

	it("pins the no-protocol-prefix assumption for reused static prompts", () => {
		for (const text of [
			COMPACTION_SYSTEM_PROMPT,
			buildCompactionPrompt("", ""),
			buildUpdateCompactionPrompt("", "", ""),
		]) {
			assert.doesNotMatch(text, /@\|*!/);
		}
	});
});
