import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { BOULDER_RESUME_MESSAGE_TYPE } from "../hooks/boulder-resume-message.js";
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
import { providerCallCount } from "./prepare-compaction-request-provider-guard.js";

afterEach(() => assert.equal(providerCallCount, 0));

it("uses actual source scope once, propagates call options, and returns expanded boundary fields", async () => {
	const event = runtimeEvent([
		user("first-source"),
		{
			role: "custom",
			customType: BOULDER_RESUME_MESSAGE_TYPE,
			content: "DROP_RESUME",
			display: true,
			timestamp: 0,
		},
		assistant([{ type: "text", text: "assistant-visible" }]),
		tool("tool-visible"),
		{
			role: "custom",
			customType: "other",
			content: "custom-visible",
			display: true,
			timestamp: 0,
		},
		user([
			{ type: "text", text: "mixed-visible" },
			{ type: "image", data: "AA==", mimeType: "image/png" },
		]),
		user("second-source"),
	]);
	event.preparation.turnPrefixMessages = [user("EXCLUDED_PREFIX")];
	event.customInstructions = "focus @!88@";
	const task = {
		id: 1,
		text: "task @!89@",
		status: "pending" as const,
		blocks: [],
		blockedBy: [],
		createdAt: 0,
		updatedAt: 0,
	};
	const harness = createHandler({
		readTasks: () => ({
			tasks: [task],
			actionableCount: 1,
			readyTasks: [task],
		}),
	});
	resetCompletion(
		completedResponse([
			{ type: "thinking", thinking: "not saved" },
			{ type: "text", text: "@!2@ / " },
			{ type: "text", text: "@!1@" },
		]),
	);
	const result = await harness.run(event);
	assert.deepEqual(result, {
		compaction: {
			summary: "second-source / first-source",
			firstKeptEntryId: "kept",
			tokensBefore: 100,
		},
	});
	const prompt = sentPrompt();
	assert.match(prompt, /\[User\]: @!1@first-source@!@/);
	assert.match(prompt, /\[User\]: @!2@second-source@!@/);
	assert.match(prompt, /assistant-visible/);
	assert.match(prompt, /tool-visible/);
	assert.match(prompt, /\[User\]: custom-visible/);
	assert.match(prompt, /\[User\]: mixed-visible/);
	assert.match(prompt, /focus @\|!88@/);
	assert.match(prompt, /task @\|!89@/);
	assert.doesNotMatch(
		prompt,
		/DROP_RESUME|EXCLUDED_PREFIX|old \/ potential|<current_history>/,
	);
	assert.equal(prompt.split("first-source").length, 2);
	assert.equal(harness.taskReads, 1);
	assert.deepEqual(harness.authModels, [runtimeModel]);
	assert.equal(completionCalls[0][0], runtimeModel);
	assert.deepEqual(completionCalls[0][2], {
		maxTokens: Math.floor(0.8 * 1024),
		signal: event.signal,
		apiKey: "offline-dummy-key",
		headers: harness.headers,
		reasoning: "high",
	});
	assert.deepEqual(harness.statuses, [
		"⚡ Compacting (oh-my-pi)...",
		undefined,
	]);
});
