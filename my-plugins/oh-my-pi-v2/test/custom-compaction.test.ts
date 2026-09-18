import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BOULDER_RESUME_MESSAGE_TYPE } from "../hooks/boulder-resume-message.js";
import { buildCompactionContext } from "../hooks/compaction-conversation.js";
import { buildCompactionPrompt } from "../hooks/compaction-prompt.js";
import type { Task } from "../tools/task.js";

function task(id: number, text: string, status: Task["status"]): Task {
	return {
		id,
		text,
		status,
		blocks: [],
		blockedBy: [],
		createdAt: 0,
		updatedAt: 0,
	};
}

function resumeMessage(resumeId: string, content: string): AgentMessage {
	return {
		role: "custom",
		customType: BOULDER_RESUME_MESSAGE_TYPE,
		content,
		display: true,
		details: { resumeId },
		timestamp: 0,
	};
}

describe("custom compaction context", () => {
	it("filters every Boulder resume while preserving conversation and actionable tasks", () => {
		const started = task(1, "started task remains", "in_progress");
		const ready = task(2, "ready task remains", "pending");
		const completed = task(3, "completed task is omitted", "done");
		const messages: AgentMessage[] = [
			{ role: "user", content: "ordinary request remains", timestamp: 0 },
			resumeMessage("stale", "STALE_RESUME_MUST_NOT_REACH_COMPACTION"),
			resumeMessage("current", "CURRENT_RESUME_MUST_NOT_REACH_COMPACTION"),
			{
				role: "assistant",
				content: [{ type: "text", text: "ordinary answer remains" }],
				api: "test",
				provider: "test",
				model: "test",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 0,
			},
		];
		let serializedMessages: AgentMessage[] = [];
		const eventContext = { sessionManager: {} } as unknown as ExtensionContext;
		let taskReadContext: ExtensionContext | undefined;
		const compactionContext = buildCompactionContext(
			messages,
			(context) => {
				taskReadContext = context;
				return {
					tasks: [started, ready, completed],
					actionableCount: 2,
					readyTasks: [ready],
				};
			},
			eventContext,
			(filteredMessages) => {
				serializedMessages = filteredMessages;
				return filteredMessages
					.map((message) => {
						assert.ok("content" in message);
						return JSON.stringify(message.content);
					})
					.join("\n");
			},
		);
		const prompt = buildCompactionPrompt(
			compactionContext.conversationText,
			compactionContext.taskContext,
		);

		assert.equal(taskReadContext, eventContext);
		assert.equal(serializedMessages.length, 2);
		assert.match(prompt, /ordinary request remains/);
		assert.match(prompt, /ordinary answer remains/);
		assert.doesNotMatch(prompt, /STALE_RESUME_MUST_NOT_REACH_COMPACTION/);
		assert.doesNotMatch(prompt, /CURRENT_RESUME_MUST_NOT_REACH_COMPACTION/);
		assert.match(prompt, /\[#1\] started task remains \(in_progress\)/);
		assert.match(prompt, /\[#2\] ready task remains \(pending\)/);
		assert.doesNotMatch(prompt, /completed task is omitted/);
	});
});
