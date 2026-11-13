import assert from "node:assert/strict";
import test from "node:test";
import { formatRelayCompact, formatRelayText, parseRelayBalance, queryRelayBalance } from "../src/relay-balance.js";
import { executeUsageQuery } from "../src/usage-query.js";
import type { RequestAuth, UsageModel } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

// openlux /api/usage/token/ 的真实响应（2026-11-10 实测）：500000 配额 = 1 美元。
const openluxResponse = {
	success: true,
	message: "",
	data: {
		expires_at: 0,
		model_limits: {},
		model_limits_enabled: false,
		name: "guanyan",
		object: "token_usage",
		total_available: 74_843_016,
		total_granted: 108_379_535,
		total_used: 33_536_519,
		unlimited_quota: false,
	},
};

const relayAuth: RequestAuth = {
	route: "relay",
	endpoint: "https://api.openlux.ai",
	headers: { Authorization: "Bearer sk-test" },
};

interface FetchCall {
	url: string;
	authorization: string;
}

async function withFetch(responses: Response[], run: (calls: FetchCall[]) => Promise<void>): Promise<void> {
	const originalFetch = globalThis.fetch;
	const calls: FetchCall[] = [];
	const queue = [...responses];
	globalThis.fetch = async (input, init) => {
		calls.push({
			url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
			authorization: new Headers(init?.headers).get("authorization") ?? "",
		});
		const next = queue.shift();
		if (!next) throw new Error("unexpected request");
		return next;
	};
	try {
		await run(calls);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

test("parses the openlux token_usage payload into a dollar balance", () => {
	const balance = parseRelayBalance(openluxResponse);
	assert.deepEqual(balance, {
		unlimited: false,
		availableUsd: 149.69,
		usedUsd: 67.07,
		grantedUsd: 216.76,
		tokenName: "guanyan",
	});
	assert.equal(formatRelayCompact(balance!), "Bal $149.69");
	assert.equal(formatRelayText(balance!), "Balance $149.69, used $67.07 / granted $216.76 (key: guanyan)");
});

test("renders unlimited tokens without a made-up balance", () => {
	const balance = parseRelayBalance({ ...openluxResponse, data: { ...openluxResponse.data, unlimited_quota: true } });
	assert.equal(balance?.unlimited, true);
	assert.equal(formatRelayCompact(balance!), "Bal ∞");
	assert.equal(formatRelayText(balance!), "Unlimited balance (key: guanyan)");
});

test("rejects payloads that are not the new-api token_usage schema", () => {
	assert.equal(parseRelayBalance(undefined), undefined);
	assert.equal(parseRelayBalance({ success: false, message: "无效的令牌", data: null }), undefined);
	assert.equal(parseRelayBalance({ success: true, data: { object: "list", total_usage: 1 } }), undefined);
	assert.equal(parseRelayBalance({ success: true, data: { ...openluxResponse.data, total_available: "many" } }), undefined);
});

test("queries the relay balance at the trailing-slash token endpoint", async () => {
	await withFetch([new Response(JSON.stringify(openluxResponse), { status: 200 })], async (calls) => {
		const result = await queryRelayBalance(relayAuth, new AbortController().signal);
		assert.equal(result.kind, "available");
		assert.deepEqual(calls, [{ url: "https://api.openlux.ai/api/usage/token/", authorization: "Bearer sk-test" }]);
	});
});

test("maps 404 and unknown JSON to unsupported, auth failures to AUTH", async () => {
	await withFetch([new Response("nope", { status: 404 })], async () => {
		assert.deepEqual(await queryRelayBalance(relayAuth, new AbortController().signal), { kind: "unsupported" });
	});
	await withFetch([new Response(JSON.stringify({ data: { object: "list" } }), { status: 200 })], async () => {
		assert.deepEqual(await queryRelayBalance(relayAuth, new AbortController().signal), { kind: "unsupported" });
	});
	await withFetch([new Response(JSON.stringify({ error: { message: "无效的令牌", type: "new_api_error" } }), { status: 401 })], async () => {
		assert.deepEqual(await queryRelayBalance(relayAuth, new AbortController().signal), { kind: "error", code: "auth" });
	});
});

test("caches a relay miss per endpoint so refreshes stop probing the same host", async () => {
	const model: UsageModel = makeModel({ provider: "openlux", api: "openai-completions", baseUrl: "https://api.openlux.ai/v1" });
	const registry = { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "sk-test" }) };
	const misses = new Set<string>();
	await withFetch([new Response("nope", { status: 404 })], async (calls) => {
		const first = await executeUsageQuery(
			{ sessionId: "s", model, modelId: model.id, providerId: model.provider, api: model.api, endpoint: model.baseUrl! },
			{ kind: "relay", endpoint: "https://api.openlux.ai" },
			registry,
			new AbortController().signal,
			undefined,
			misses,
		);
		assert.deepEqual(first, { kind: "unsupported" });
		const second = await executeUsageQuery(
			{ sessionId: "s", model, modelId: model.id, providerId: model.provider, api: model.api, endpoint: model.baseUrl! },
			{ kind: "relay", endpoint: "https://api.openlux.ai" },
			registry,
			new AbortController().signal,
			undefined,
			misses,
		);
		assert.deepEqual(second, { kind: "unsupported" });
		assert.equal(calls.length, 1);
	});
});
