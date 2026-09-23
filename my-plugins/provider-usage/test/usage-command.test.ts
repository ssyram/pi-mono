import assert from "node:assert/strict";
import test from "node:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { completeProviderUsageArgs, createProviderUsageCompletion } from "../src/command-completion.js";
import { resolveUsageTargets } from "../src/command-targets.js";
import type { PiExtensionContext } from "../src/pi-extension-contract.js";
import { runUsageCommand } from "../src/usage-command.js";
import type { UsageModel } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

const first = makeModel({ provider: "zai-001", baseUrl: "https://api.z.ai/api/coding/paas/v4" });
const second = makeModel({ provider: "zai-002", baseUrl: "https://api.z.ai/api/coding/paas/v4" });
const unsupported = makeModel({ provider: "other", baseUrl: "https://other.example/v1" });
const models = [first, second, unsupported];

function context(notices: string[]): PiExtensionContext {
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
			getAvailable: () => [first, second, second],
			getProvider: () => undefined,
			getApiKeyAndHeaders: async (model: UsageModel) => ({ ok: true, apiKey: model.provider }),
			isUsingOAuth: () => false,
		},
		ui: {
			setFooter: () => {},
			notify: (text) => { notices.push(text); },
			addAutocompleteProvider: () => {},
		},
		getContextUsage: () => undefined,
	};
}

test("resolves current, available deduplicated, and explicitly named providers", () => {
	const registry = context([]).modelRegistry;
	assert.deepEqual(resolveUsageTargets("", first, registry), { kind: "targets", models: [first], unknown: [] });
	assert.deepEqual(resolveUsageTargets("--all", first, registry), { kind: "targets", models: [first, second], unknown: [] });
	assert.deepEqual(resolveUsageTargets("zai-002 missing zai-001 zai-002", first, registry), {
		kind: "targets", models: [second, first], unknown: ["missing"],
	});
	assert.equal(resolveUsageTargets("--all zai-001", first, registry).kind, "error");
});

test("forced Tab and native completions retain prior names", async () => {
	const registry = context([]).modelRegistry;
	assert.deepEqual(completeProviderUsageArgs("zai-001 zai-0", registry, first)?.map((item) => item.value), ["zai-001 zai-002"]);
	const base: AutocompleteProvider = {
		getSuggestions: async () => null,
		applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
	};
	const provider = createProviderUsageCompletion(base, () => ({ registry, model: first }));
	const before = "/provider-usage zai-001 zai-0";
	const tab = provider as AutocompleteProvider & { shouldTriggerFileCompletion?(lines: string[], line: number, col: number): boolean };
	assert.equal(tab.shouldTriggerFileCompletion?.(["/provider-usage "], 0, 16), true);
	const suggestions = await provider.getSuggestions([before], 0, before.length, { signal: new AbortController().signal, force: true });
	assert.deepEqual(suggestions?.items.map((item) => item.value), ["zai-002"]);
	const result = provider.applyCompletion([before], 0, before.length, suggestions?.items[0] ?? { value: "", label: "" }, "zai-0");
	assert.deepEqual(result.lines, ["/provider-usage zai-001 zai-002 "]);
});

test("command queries each requested account independently and leaves details out of footer", async () => {
	const originalFetch = globalThis.fetch;
	const headers: string[] = [];
	globalThis.fetch = async (_input, options) => {
		headers.push(new Headers(options?.headers).get("authorization") ?? "");
		return new Response(JSON.stringify({ success: true, code: 200, data: { limits: [
			{ type: "TOKENS_LIMIT", percentage: 17, unit: 3, number: 5, nextResetTime: 1_800_000_000_000 },
		] } }), { status: 200 });
	};
	try {
		const notices: string[] = [];
		const ctx = context(notices);
		await runUsageCommand("zai-002 missing zai-001", ctx);
		assert.deepEqual(headers, ["Bearer zai-002", "Bearer zai-001"]);
		assert.match(notices[0] ?? "", /^zai-002: 已用 17%\(5h\) 重置 /);
		assert.match(notices[0] ?? "", /zai-001: 已用 17%\(5h\) 重置 /);
		assert.match(notices[0] ?? "", /missing: 未找到 provider$/);
		assert.equal(ctx.model, first);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
