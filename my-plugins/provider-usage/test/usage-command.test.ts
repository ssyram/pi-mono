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
			setWidget: () => {},
			notify: (text) => { notices.push(text); },
			addAutocompleteProvider: () => {},
		},
		getContextUsage: () => undefined,
	};
}

test("resolves current, available deduplicated, and explicitly named providers", () => {
	const registry = context([]).modelRegistry;
	assert.deepEqual(resolveUsageTargets("", first, registry), { kind: "targets", models: [first], unknown: [], showToAi: false });
	assert.deepEqual(resolveUsageTargets("--all", first, registry), { kind: "targets", models: [first, second], unknown: [], showToAi: false });
	assert.deepEqual(resolveUsageTargets("zai-002 missing zai-001 zai-002", first, registry), {
		kind: "targets", models: [second, first], unknown: ["missing"], showToAi: false,
	});
	assert.equal(resolveUsageTargets("--all zai-001", first, registry).kind, "error");
});

test("--show-to-ai parses in any argument position and never unlocks --all mixing", () => {
	const registry = context([]).modelRegistry;
	assert.deepEqual(resolveUsageTargets("--show-to-ai", first, registry), {
		kind: "targets", models: [first], unknown: [], showToAi: true,
	});
	assert.deepEqual(resolveUsageTargets("--show-to-ai --all", first, registry), {
		kind: "targets", models: [first, second], unknown: [], showToAi: true,
	});
	assert.deepEqual(resolveUsageTargets("--all --show-to-ai", first, registry), {
		kind: "targets", models: [first, second], unknown: [], showToAi: true,
	});
	assert.deepEqual(resolveUsageTargets("zai-002 --show-to-ai", first, registry), {
		kind: "targets", models: [second], unknown: [], showToAi: true,
	});
	assert.equal(resolveUsageTargets("--all --show-to-ai zai-001", first, registry).kind, "error");
	assert.equal(resolveUsageTargets("--show-to-ai --bogus", first, registry).kind, "error");
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

test("--show-to-ai completes at first and second position and combines with --all", () => {
	const registry = context([]).modelRegistry;
	assert.deepEqual(completeProviderUsageArgs("--show-to", registry, first)?.map((item) => item.value), ["--show-to-ai"]);
	assert.deepEqual(completeProviderUsageArgs("zai-001 --show", registry, first)?.map((item) => item.value), ["zai-001 --show-to-ai"]);
	assert.deepEqual(completeProviderUsageArgs("--all --show", registry, first)?.map((item) => item.value), ["--all --show-to-ai"]);
	assert.deepEqual(completeProviderUsageArgs("--show-to-ai --a", registry, first)?.map((item) => item.value), ["--show-to-ai --all"]);
	assert.deepEqual(
		completeProviderUsageArgs("--show-to-ai zai-0", registry, first)?.map((item) => item.value),
		["--show-to-ai zai-001", "--show-to-ai zai-002"],
	);
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
		const outputs: Array<{ tone: string; text: string }> = [];
		const ctx = context([]);
		await runUsageCommand("zai-002 missing zai-001", ctx, undefined, undefined, (data) => outputs.push(data));
		assert.deepEqual(headers, ["Bearer zai-002", "Bearer zai-001"]);
		assert.equal(outputs.length, 1);
		assert.equal(outputs[0]?.tone, "info");
		assert.match(outputs[0]?.text ?? "", /^zai-002: 17%\(5h\) used, resets /);
		assert.match(outputs[0]?.text ?? "", /zai-001: 17%\(5h\) used, resets /);
		assert.match(outputs[0]?.text ?? "", /missing: provider not found$/);
		assert.equal(ctx.model, first);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("--show-to-ai sends the full snapshot as an AI message and skips the TUI output entry", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (_input, options) => {
		const auth = new Headers(options?.headers).get("authorization") ?? "";
		if (auth === "Bearer zai-001") return new Response("", { status: 401 });
		return new Response(JSON.stringify({ success: true, code: 200, data: { limits: [
			{ type: "TOKENS_LIMIT", percentage: 17, unit: 3, number: 5, nextResetTime: 1_800_000_000_000 },
		] } }), { status: 200 });
	};
	try {
		const outputs: Array<{ tone: string; text: string }> = [];
		const aiMessages: Array<{ content: string; details: { collapsed: string } }> = [];
		const ctx = context([]);
		await runUsageCommand(
			"zai-002 --show-to-ai missing zai-001",
			ctx,
			undefined,
			undefined,
			(data) => outputs.push(data),
			(content, details) => aiMessages.push({ content, details }),
		);
		assert.equal(outputs.length, 0);
		assert.equal(aiMessages.length, 1);
		const { content: message, details } = aiMessages[0]!;
		assert.match(message, /^Provider usage snapshot \(\/provider-usage --show-to-ai, \d{4}-\d{2}-\d{2} \d{2}:\d{2}\):$/m);
		assert.match(message, /^zai-002: 17%\(5h\) used, resets /m);
		assert.match(message, /^zai-001: AUTH$/m);
		assert.match(message, /^Codes: AUTH=authentication failed/m);
		assert.doesNotMatch(message, /provider not found/);
		assert.equal(details.collapsed, "zai-002:(17%(5h)), zai-001:(AUTH)");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
