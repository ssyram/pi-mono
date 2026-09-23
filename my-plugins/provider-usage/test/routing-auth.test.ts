import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuth } from "../src/auth.js";
import { route } from "../src/route.js";
import { captureSelection } from "../src/selection.js";
import type { Route, Selection, SupportedRouteKind, UsageModel } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

function selectionFor(model: UsageModel): Selection {
	const selection = captureSelection(
		{ sessionManager: { getSessionId: () => "session-1" }, modelRegistry: { getProvider: () => undefined } },
		model,
	);
	if (!selection) throw new Error("selection should exist");
	return selection;
}

function supportedRoute(selection: Selection): Extract<Route, { kind: SupportedRouteKind }> {
	const candidate = route(selection);
	if (candidate.kind === "error" || candidate.kind === "unsupported") throw new Error("supported route expected");
	return candidate;
}

test("treats Pi's unknown-model placeholder as no selection", () => {
	const sentinel = makeModel({ provider: "unknown", id: "unknown", api: "unknown", baseUrl: "" });
	assert.equal(
		captureSelection(
			{ sessionManager: { getSessionId: () => "session-1" }, modelRegistry: { getProvider: () => undefined } },
			sentinel,
		),
		undefined,
	);
});

test("routes by exact API and endpoint rather than provider name", () => {
	const codex = selectionFor(
		makeModel({ provider: "named-instance", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api/" }),
	);
	const zai = selectionFor(
		makeModel({ provider: "any-name", api: "openai-completions", baseUrl: "https://api.z.ai/api/coding/paas/v4" }),
	);
	const zaiCn = selectionFor(
		makeModel({ provider: "another-name", api: "openai-completions", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4" }),
	);
	const proxy = selectionFor(
		makeModel({ provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://proxy.example/backend-api" }),
	);
	assert.equal(route(codex).kind, "codex");
	assert.equal(route(zai).kind, "zai");
	assert.equal(route(zaiCn).kind, "zai-cn");
	assert.equal(route(proxy).kind, "unsupported");
	assert.deepEqual(route(selectionFor(makeModel({ api: "openai-completions", baseUrl: "http://api.z.ai/api/coding/paas/v4" }))), {
		kind: "error",
		code: "invalid-response",
	});
});

test("uses the selected Codex model authentication and derives its account header", async () => {
	const model = makeModel({ provider: "codex-002", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" });
	const selection = selectionFor(model);
	const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-test" } })).toString("base64url");
	let resolvedModel: UsageModel | undefined;
	const result = await resolveAuth(
		selection,
		supportedRoute(selection),
		{
			getApiKeyAndHeaders: async (currentModel) => {
				resolvedModel = currentModel;
				return { ok: true, apiKey: `header.${payload}.signature` };
			},
		},
		new AbortController().signal,
	);
	assert.equal(resolvedModel, model);
	assert.deepEqual(result, {
		kind: "ready",
		auth: {
			route: "codex",
			endpoint: "https://chatgpt.com/backend-api",
			headers: { Authorization: `Bearer header.${payload}.signature`, "ChatGPT-Account-Id": "acct-test" },
		},
	});
});

test("honors explicit authentication, rejects cross-route overrides, and never resolves after abort", async () => {
	const selection = selectionFor(
		makeModel({ provider: "zai-named", api: "openai-completions", baseUrl: "https://api.z.ai/api/coding/paas/v4" }),
	);
	const explicit = await resolveAuth(
		selection,
		supportedRoute(selection),
		{ getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "ignored", headers: { authorization: "Explicit auth" } }) },
		new AbortController().signal,
	);
	assert.deepEqual(explicit, {
		kind: "ready",
		auth: {
			route: "zai",
			endpoint: "https://api.z.ai/api/coding/paas/v4",
			headers: { Authorization: "Explicit auth" },
		},
	});
	const changedEndpoint = await resolveAuth(
		selection,
		supportedRoute(selection),
		{ getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fake", baseUrl: "https://chatgpt.com/backend-api" }) },
		new AbortController().signal,
	);
	assert.deepEqual(changedEndpoint, { kind: "unsupported" });
	const abort = new AbortController();
	abort.abort();
	let calls = 0;
	const cancelled = await resolveAuth(
		selection,
		supportedRoute(selection),
		{
			getApiKeyAndHeaders: async () => {
				calls += 1;
				return { ok: true, apiKey: "fake" };
			},
		},
		abort.signal,
	);
	assert.deepEqual(cancelled, { kind: "cancelled" });
	assert.equal(calls, 0);
});

test("retains complete CN team context from the selected model and rejects partial context", async () => {
	const selection = selectionFor(makeModel({ provider: "zai-coding-cn", api: "openai-completions", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4" }));
	const complete = await resolveAuth(
		selection, supportedRoute(selection),
		{ getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fake", headers: {
			"Bigmodel-Organization": "org-test", "Bigmodel-Project": "proj-test",
		} }) },
		new AbortController().signal,
	);
	assert.deepEqual(complete, { kind: "ready", auth: {
		route: "zai-cn", endpoint: "https://open.bigmodel.cn/api/coding/paas/v4", headers: {
			Authorization: "fake", "bigmodel-organization": "org-test", "bigmodel-project": "proj-test",
		},
	} });
	const partial = await resolveAuth(
		selection, supportedRoute(selection),
		{ getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fake", headers: { "bigmodel-organization": "org-test" } }) },
		new AbortController().signal,
	);
	assert.deepEqual(partial, { kind: "unsupported" });
});

test("marks unsupported Z.AI organization selection instead of silently using a personal account", async () => {
	const selection = selectionFor(
		makeModel({ provider: "zai", api: "openai-completions", baseUrl: "https://api.z.ai/api/coding/paas/v4" }),
	);
	const result = await resolveAuth(
		selection,
		supportedRoute(selection),
		{ getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fake", headers: { "ZAI-Organization": "org-test" } }) },
		new AbortController().signal,
	);
	assert.deepEqual(result, { kind: "unsupported" });
});
