import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	BOULDER_RESUME_MESSAGE_TYPE,
	type BoulderResumeDetails,
	registerBoulderResumeMessages,
} from "../hooks/boulder-resume-message.js";
import { registerTaskTool } from "../tools/task.js";

type ContextHandler = (
	event: { messages: AgentMessage[] },
	context: ExtensionContext,
) => { messages?: AgentMessage[] } | void;
type InputHandler = (event: { source: "interactive" | "rpc" | "extension" }, context: ExtensionContext) => void;
type LifecycleHandler = (event: object, context: ExtensionContext) => void;
type ResumeRenderer = (
	message: { content: string; details?: BoulderResumeDetails },
	options: { expanded: boolean },
	theme: { fg: (color: string, text: string) => string },
) => { render: (width: number) => string[] } | undefined;

function context(sessionIdentity: object, idle: boolean): ExtensionContext {
	return {
		sessionManager: sessionIdentity,
		isIdle: () => idle,
	} as unknown as ExtensionContext;
}

function customMessage(resumeId: string, customType = BOULDER_RESUME_MESSAGE_TYPE): AgentMessage {
	return {
		role: "custom",
		customType,
		content: "resume",
		display: true,
		details: { resumeId, attempt: 1, maxAttempts: 10, scheduledDelayMs: 10_000 },
		timestamp: 0,
	} as AgentMessage;
}

function createHarness(): {
	pi: ExtensionAPI;
	sent: Array<{ message: { customType: string; content: string; details?: BoulderResumeDetails }; options?: object }>;
	contextHandler: () => ContextHandler;
	inputHandler: () => InputHandler;
	agentEndHandler: () => LifecycleHandler;
	renderer: () => ResumeRenderer;
} {
	const sent: Array<{ message: { customType: string; content: string; details?: BoulderResumeDetails }; options?: object }> = [];
	let onContext: ContextHandler | undefined;
	let onInput: InputHandler | undefined;
	let onAgentEnd: LifecycleHandler | undefined;
	let messageRenderer: ResumeRenderer | undefined;
	const pi = {
		registerMessageRenderer: (_type: string, renderer: ResumeRenderer) => {
			messageRenderer = renderer;
		},
		on: (event: string, handler: unknown) => {
			if (event === "context") onContext = handler as ContextHandler;
			if (event === "input") onInput = handler as InputHandler;
			if (event === "agent_end") onAgentEnd = handler as LifecycleHandler;
		},
		sendMessage: (message: { customType: string; content: string; details?: BoulderResumeDetails }, options?: object) => {
			sent.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		sent,
		contextHandler: () => onContext ?? (() => undefined),
		inputHandler: () => onInput ?? (() => undefined),
		agentEndHandler: () => onAgentEnd ?? (() => undefined),
		renderer: () => messageRenderer ?? (() => undefined),
	};
}

describe("Boulder resume custom message", () => {
	it("keeps only the live resume in its owning session", () => {
		const harness = createHarness();
		const controller = registerBoulderResumeMessages(harness.pi);
		const owner = context({}, true);
		const otherSession = context({}, true);

		controller.send(
			owner,
			[
				{ id: 1, text: "started", status: "in_progress" },
				{ id: 2, text: "ready", status: "pending" },
			],
			{ attempt: 1, maxAttempts: 10, scheduledDelayMs: 10_000 },
		);

		assert.equal(harness.sent.length, 1);
		const sent = harness.sent[0];
		assert.equal(sent?.message.customType, BOULDER_RESUME_MESSAGE_TYPE);
		assert.deepEqual(sent?.options, { triggerTurn: true });
		assert.match(sent?.message.content ?? "", /1\. \[in_progress\] #1: started/);
		assert.match(sent?.message.content ?? "", /2\. \[ready\] #2: ready/);
		assert.match(sent?.message.content ?? "", /<CONFIRM-TO-STOP\/>/);
		assert.match(sent?.message.content ?? "", /generated automatically by the system, not sent by the user/i);
		assert.doesNotMatch(sent?.message.content ?? "", /attempt|delay|countdown|10s/i);
		assert.deepEqual(
			{
				attempt: sent?.message.details?.attempt,
				maxAttempts: sent?.message.details?.maxAttempts,
				scheduledDelayMs: sent?.message.details?.scheduledDelayMs,
			},
			{ attempt: 1, maxAttempts: 10, scheduledDelayMs: 10_000 },
		);
		const liveId = sent?.message.details?.resumeId;
		if (!liveId) throw new Error("resumeId was not recorded");
		const unrelated = customMessage("unrelated", "other-extension");
		const messages = [customMessage("old"), unrelated, customMessage(liveId)];

		assert.deepEqual(harness.contextHandler()({ messages }, owner)?.messages, [unrelated, messages[2]]);
		assert.deepEqual(harness.contextHandler()({ messages }, otherSession)?.messages, [unrelated]);
	});

	it("always triggers a turn and clears live state for external input and agent end", () => {
		const harness = createHarness();
		const controller = registerBoulderResumeMessages(harness.pi);
		const owner = context({}, false);
		controller.send(
			owner,
			[{ id: 1, text: "ready", status: "pending" }],
			{ attempt: 1, maxAttempts: 10, scheduledDelayMs: 10_000 },
		);
		assert.deepEqual(harness.sent[0]?.options, { triggerTurn: true });
		const liveId = harness.sent[0]?.message.details?.resumeId;
		if (!liveId) throw new Error("resumeId was not recorded");
		const messages = [customMessage(liveId)];

		harness.inputHandler()({ source: "extension" }, owner);
		assert.equal(harness.contextHandler()({ messages }, owner)?.messages?.length, 1);
		harness.inputHandler()({ source: "interactive" }, owner);
		assert.deepEqual(harness.contextHandler()({ messages }, owner)?.messages, []);

		controller.send(
			owner,
			[{ id: 2, text: "started", status: "in_progress" }],
			{ attempt: 2, maxAttempts: 10, scheduledDelayMs: 10_000 },
		);
		const rpcResumeId = harness.sent[1]?.message.details?.resumeId;
		if (!rpcResumeId) throw new Error("RPC resumeId was not recorded");
		harness.inputHandler()({ source: "rpc" }, owner);
		assert.deepEqual(harness.contextHandler()({ messages: [customMessage(rpcResumeId)] }, owner)?.messages, []);

		controller.send(
			owner,
			[{ id: 3, text: "started", status: "in_progress" }],
			{ attempt: 3, maxAttempts: 10, scheduledDelayMs: 10_000 },
		);
		const nextId = harness.sent[2]?.message.details?.resumeId;
		if (!nextId) throw new Error("next resumeId was not recorded");
		harness.agentEndHandler()({}, owner);
		assert.deepEqual(harness.contextHandler()({ messages: [customMessage(nextId)] }, owner)?.messages, []);
	});

	it("renders a compact label and expands to the model-visible content", () => {
		const harness = createHarness();
		registerBoulderResumeMessages(harness.pi);
		const message = {
			content: "resume content",
			details: { resumeId: "id", attempt: 4, maxAttempts: 10, scheduledDelayMs: 20_000 },
		};
		const theme = { fg: (_color: string, text: string) => text };
		const collapsed = harness.renderer()(message, { expanded: false }, theme);
		const expanded = harness.renderer()(message, { expanded: true }, theme);

		assert.deepEqual(collapsed?.render(80).map((line) => line.trimEnd()), ["↻ Automatic Boulder resume"]);
		assert.deepEqual(expanded?.render(80).map((line) => line.trimEnd()), [
			"↻ Automatic Boulder resume",
			"resume content",
		]);
	});
});

describe("task tool context behavior", () => {
	it("does not register a per-turn system-prompt handler", () => {
		const events: string[] = [];
		const pi = {
			on: (event: string) => events.push(event),
			registerTool: () => undefined,
			appendEntry: () => undefined,
		} as unknown as ExtensionAPI;

		registerTaskTool(pi);

		assert.ok(!events.includes("before_agent_start"));
	});
});
