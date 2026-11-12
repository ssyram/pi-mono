import assert from "node:assert/strict";
import test from "node:test";
import type { UsageQueryRunner } from "../src/controller-contract.js";
import type { PiExtensionContext } from "../src/pi-extension-contract.js";
import { registerUsageTool } from "../src/usage-tool.js";
import type { QueryResult, UsageModel } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

const first = makeModel({ provider: "zai-001", baseUrl: "https://api.z.ai/api/coding/paas/v4" });
const second = makeModel({ provider: "zai-002", baseUrl: "https://api.z.ai/api/coding/paas/v4" });
const models = [first, second];

interface ToolOutput {
	content: Array<{ type: string; text: string }>;
}

interface CapturedTool {
	execute(
		toolCallId: string,
		params: { provider?: string },
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: PiExtensionContext,
	): Promise<ToolOutput>;
}
function context(): PiExtensionContext {
	return {
		mode: "tui",
		model: first,
		sessionManager: {
			getSessionId: () => "session-1",
			getEntries: () => [],
			getCwd: () => "/tmp/project",
			getSessionName: () => undefined,
		},
		modelRegistry: {
			getAll: () => models,
			getAvailable: () => [first, second],
			getProvider: () => undefined,
			getApiKeyAndHeaders: async (model: UsageModel) => ({ ok: true, apiKey: model.provider }),
			isUsingOAuth: () => false,
		},
		ui: {
			setFooter: () => {},
			setWidget: () => {},
			notify: () => {},
			addAutocompleteProvider: () => {},
		},
		getContextUsage: () => undefined,
	};
}

function captureTool(queried: string[], result: QueryResult): CapturedTool {
	let captured: CapturedTool | undefined;
	const pi = {
		registerTool(definition: unknown) {
			captured = definition as CapturedTool;
		},
	};
	const query: UsageQueryRunner = (selection) => {
		queried.push(selection.providerId);
		return Promise.resolve(result);
	};
	registerUsageTool(pi, () => query);
	assert.ok(captured);
	return captured;
}

test("tool defaults to all providers and queries a single named provider", async () => {
	const all: string[] = [];
	const tool = captureTool(all, { kind: "available", text: "ok", compact: "ok" });

	const every = await tool.execute("call-1", {}, undefined, undefined, context());
	assert.deepEqual(all, ["zai-001", "zai-002"]);
	assert.equal(every.content[0]?.type, "text");
	assert.equal(every.content[0]?.text, "zai-001: ok\nzai-002: ok");

	const single: string[] = [];
	const namedTool = captureTool(single, { kind: "available", text: "ok", compact: "ok" });
	const one = await namedTool.execute("call-2", { provider: "zai-002" }, undefined, undefined, context());
	assert.deepEqual(single, ["zai-002"]);
	assert.equal(one.content[0]?.text, "zai-002: ok");
});

test("tool reports unknown provider names as text", async () => {
	const queried: string[] = [];
	const tool = captureTool(queried, { kind: "available", text: "ok", compact: "ok" });

	const result = await tool.execute("call-3", { provider: "missing" }, undefined, undefined, context());
	assert.deepEqual(queried, []);
	assert.equal(result.content[0]?.text, "missing: provider not found");
});
