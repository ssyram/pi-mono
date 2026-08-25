import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerBoulder } from "../hooks/boulder.js";
import { BOULDER_RESUME_MESSAGE_TYPE } from "../hooks/boulder-resume-message.js";

type Handler = (event: unknown, context: ExtensionContext) => unknown;

it("dispatches the existing Boulder timer as a custom resume message", async (testContext) => {
	testContext.mock.timers.enable({ apis: ["setTimeout"] });
	const handlers = new Map<string, Handler[]>();
	const sentMessages: Array<{ customType: string; content: string }> = [];
	let userMessageCount = 0;
	const pi = {
		on: (event: string, handler: Handler) => {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		events: {
			on: () => () => undefined,
			emit: () => undefined,
		},
		registerMessageRenderer: () => undefined,
		registerEntryRenderer: () => undefined,
		appendEntry: () => undefined,
		sendMessage: (message: { customType: string; content: string }) => sentMessages.push(message),
		sendUserMessage: () => {
			userMessageCount += 1;
		},
	} as unknown as ExtensionAPI;
	const sessionIdentity = {
		getSessionFile: () => "integration-session",
		getSessionId: () => "integration-session",
	};
	const context = {
		mode: "print",
		hasUI: false,
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: sessionIdentity,
		ui: { notify: () => undefined },
	} as unknown as ExtensionContext;
	const taskReadContexts: ExtensionContext[] = [];
	registerBoulder(pi, (readerContext) => {
		taskReadContexts.push(readerContext);
		return {
			tasks: [{ id: 1, text: "active task", status: "in_progress", updatedAt: 0 }],
			pendingCount: 1,
			actionableCount: 1,
			readyTasks: [],
		};
	});

	for (const handler of handlers.get("session_start") ?? []) {
		await handler({ reason: "new" }, context);
	}
	for (const handler of handlers.get("agent_end") ?? []) {
		await handler(
			{
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "Finished the current step and should continue working." }],
						stopReason: "stop",
					},
				],
			},
			context,
		);
	}
	for (const handler of handlers.get("agent_settled") ?? []) {
		await handler({}, context);
	}

	testContext.mock.timers.tick(10_000);
	assert.equal(sentMessages.length, 1);
	assert.equal(sentMessages[0]?.customType, BOULDER_RESUME_MESSAGE_TYPE);
	assert.match(sentMessages[0]?.content ?? "", /\[in_progress\] #1: active task/);
	assert.equal(userMessageCount, 0);
	assert.ok(taskReadContexts.every((readerContext) => readerContext === context));
	testContext.mock.timers.reset();
});
