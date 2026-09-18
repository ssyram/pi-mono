import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionHandler,
	SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { SessionBeforeCompactResult } from "../../../packages/coding-agent/dist/core/extensions/types.js";
import { COMPACTION_SYSTEM_PROMPT } from "../hooks/compaction-prompt.js";
import type { CompactionTaskStateReader } from "../hooks/compaction-task-context.js";
import { registerCustomCompaction } from "../hooks/custom-compaction.js";
import { completionCalls } from "./custom-compaction-runtime-completion.js";
import {
	compactEvent,
	noTasks,
} from "./prepare-compaction-request-fixtures.js";

type Handler = ExtensionHandler<
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult
>;
type AuthMethod = ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"];
type AuthResult = Awaited<ReturnType<AuthMethod>>;

export const runtimeModel: Model<Api> = {
	id: "offline-model",
	name: "Offline model",
	api: "test",
	provider: "test",
	baseUrl: "https://unused.invalid",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 16384,
};

export function runtimeEvent(
	messages: AgentMessage[],
	previousSummary?: string,
) {
	return {
		...compactEvent(messages, previousSummary),
		type: "session_before_compact" as const,
		branchEntries: [],
		reason: "manual" as const,
		willRetry: false,
		signal: new AbortController().signal,
	};
}

export function createHandler(
	options: {
		model?: Model<Api> | null;
		auth?: AuthResult | Error;
		statusFailure?: "start" | "clear";
		readTasks?: CompactionTaskStateReader;
	} = {},
) {
	let registered: Handler | undefined;
	let taskReads = 0;
	const statuses: (string | undefined)[] = [];
	const authModels: Parameters<AuthMethod>[0][] = [];
	const headers = { "x-offline-test": "header" };
	const getApiKeyAndHeaders: AuthMethod = async (model) => {
		authModels.push(model);
		if (options.auth instanceof Error) throw options.auth;
		return options.auth ?? { ok: true, apiKey: "offline-dummy-key", headers };
	};
	const setStatus: ExtensionContext["ui"]["setStatus"] = (key, text) => {
		assert.equal(key, "omp-compact");
		statuses.push(text);
		if (
			(text === undefined && options.statusFailure === "clear") ||
			(text !== undefined && options.statusFailure === "start")
		) {
			throw new Error("Controlled status failure");
		}
	};
	const context = {
		model: options.model === null ? undefined : (options.model ?? runtimeModel),
		modelRegistry: { getApiKeyAndHeaders },
		ui: { setStatus },
		sessionManager: {},
	} as unknown as ExtensionContext;
	const on = (name: string, handler: Handler): void => {
		assert.equal(name, "session_before_compact");
		assert.equal(registered, undefined);
		registered = handler;
	};
	registerCustomCompaction({ on } as unknown as ExtensionAPI, (received) => {
		assert.equal(received, context);
		taskReads++;
		return (options.readTasks ?? noTasks)(received);
	});
	assert.ok(registered);
	const handler = registered;
	return {
		context,
		statuses,
		authModels,
		headers,
		get taskReads() {
			return taskReads;
		},
		run: (event: SessionBeforeCompactEvent) => handler(event, context),
	};
}

export function sentPrompt(): string {
	assert.equal(completionCalls.length, 1);
	const request = completionCalls[0][1];
	assert.equal(request.systemPrompt, COMPACTION_SYSTEM_PROMPT);
	assert.equal(request.messages.length, 1);
	assert.equal(request.messages[0].role, "user");
	const content = request.messages[0].content;
	assert.ok(typeof content === "string");
	return content;
}
