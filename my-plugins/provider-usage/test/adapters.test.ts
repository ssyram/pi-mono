import assert from "node:assert/strict";
import test from "node:test";
import { queryCodex } from "../src/codex-query.js";
import { parseZaiQuota } from "../src/zai-quota.js";
import { queryZaiCn } from "../src/zai-cn-query.js";
import { queryZai } from "../src/zai-query.js";
import type { RequestAuth } from "../src/usage-contract.js";

interface FetchCall {
	url: string;
	init: RequestInit | undefined;
}

function fetchUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

async function withFetch(response: Response | Response[], run: (calls: FetchCall[]) => Promise<void>): Promise<void> {
	const originalFetch = globalThis.fetch;
	const calls: FetchCall[] = [];
	const responses = Array.isArray(response) ? [...response] : [response];
	globalThis.fetch = async (input, init) => {
		calls.push({ url: fetchUrl(input), init });
		const next = responses.shift();
		if (!next) throw new Error("unexpected request");
		return next;
	};
	try {
		await run(calls);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

const codexAuth: RequestAuth = {
	route: "codex",
	endpoint: "https://chatgpt.com/backend-api",
	headers: { Authorization: "Bearer fake-token", "ChatGPT-Account-Id": "acct-test" },
};

test("queries Codex once at the fixed endpoint and formats validated windows", async () => {
	await withFetch(
		new Response(
			JSON.stringify({
				rate_limit: {
					primary_window: { used_percent: 34, limit_window_seconds: 604800 },
					secondary_window: null,
				},
				code_review_rate_limit: null,
				additional_rate_limits: [
					{
						limit_name: "Review",
						rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000 }, secondary_window: null },
					},
				],
				credits: { has_credits: false, unlimited: false, balance: "0" },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		),
		async (calls) => {
			const result = await queryCodex(codexAuth, new AbortController().signal);
			assert.deepEqual(result, { kind: "available", text: "已用 34%(week), Review 已用 12%(5h)", compact: "34%(week)" });
			assert.equal(calls.length, 1);
			assert.equal(calls[0]?.url, "https://chatgpt.com/backend-api/wham/usage");
			assert.deepEqual(calls[0]?.init?.headers, {
				Authorization: "Bearer fake-token",
				"ChatGPT-Account-Id": "acct-test",
				Accept: "application/json",
			});
			assert.equal(calls[0]?.init?.redirect, "error");
		},
	);
});

test("keeps Z.AI regions separate and preserves their resolved authorization form", async () => {
	const quotaResponse = {
		success: true,
		code: 200,
		data: {
			limits: [
				{ type: "TOKENS_LIMIT", percentage: 17, unit: 3, number: 5, nextResetTime: 1_800_000_000_000 },
				{ type: "TIME_LIMIT", currentValue: 12, usage: 1000, unit: 5, number: 1, usageDetails: [{ modelCode: "glm-test", usage: 4 }] },
			],
		},
	};
	await withFetch(
		new Response(JSON.stringify(quotaResponse), { status: 200, headers: { "content-type": "application/json" } }),
		async (calls) => {
			const result = await queryZai(
				{ route: "zai", endpoint: "https://api.z.ai/api/coding/paas/v4", headers: { Authorization: "Bearer international" } },
				new AbortController().signal,
			);
			assert.deepEqual(result, { kind: "available", text: "已用 17%(5h) 重置 2027-01-15T08:00:00.000Z, 工具 12/1000(month) glm-test 4", compact: "17%(5h)" });
			assert.equal(calls[0]?.url, "https://api.z.ai/api/monitor/usage/quota/limit");
			assert.deepEqual(calls[0]?.init?.headers, { Authorization: "Bearer international", Accept: "application/json" });
		},
	);
	await withFetch(
		new Response(JSON.stringify(quotaResponse), { status: 200, headers: { "content-type": "application/json" } }),
		async (calls) => {
			const result = await queryZaiCn(
				{ route: "zai-cn", endpoint: "https://open.bigmodel.cn/api/coding/paas/v4", headers: { Authorization: "cn-token" } },
				new AbortController().signal,
			);
			assert.equal(result.kind, "available");
			assert.equal(calls[0]?.url, "https://open.bigmodel.cn/api/monitor/usage/quota/limit");
			assert.deepEqual(calls[0]?.init?.headers, { Authorization: "cn-token", Accept: "application/json" });
		},
	);
});

test("confirms a Z.AI international no-plan result with the same account's empty subscription list", async () => {
	await withFetch(
		[
			new Response(JSON.stringify({ code: 500, success: false, msg: "当前用户不存在coding plan" }), { status: 200 }),
			new Response(JSON.stringify({ code: 200, success: true, data: [] }), { status: 200 }),
		],
		async (calls) => {
			const auth: RequestAuth = { route: "zai", endpoint: "https://api.z.ai/api/coding/paas/v4", headers: { Authorization: "Bearer fake-key" } };
			assert.deepEqual(await queryZai(auth, new AbortController().signal), { kind: "not-applicable" });
			assert.deepEqual(calls.map((call) => call.url), [
				"https://api.z.ai/api/monitor/usage/quota/limit",
				"https://api.z.ai/api/biz/subscription/list",
			]);
			assert.deepEqual(calls[1]?.init?.headers, { Authorization: "Bearer fake-key", Accept: "application/json" });
		},
	);
	await withFetch(
		[
			new Response(JSON.stringify({ code: 500, success: false, msg: "当前用户不存在coding plan" }), { status: 200 }),
			new Response(JSON.stringify({ code: 200, success: true, data: [{ productName: "Coding Pro" }] }), { status: 200 }),
		],
		async () => {
			const auth: RequestAuth = { route: "zai", endpoint: "https://api.z.ai/api/coding/paas/v4", headers: { Authorization: "Bearer fake-key" } };
			assert.deepEqual(await queryZai(auth, new AbortController().signal), { kind: "error", code: "invalid-response" });
		},
	);
	await withFetch(new Response(JSON.stringify({ code: 500, success: false, msg: "当前用户不存在coding plan" }), { status: 200 }), async (calls) => {
		const auth: RequestAuth = { route: "zai-cn", endpoint: "https://open.bigmodel.cn/api/coding/paas/v4", headers: { Authorization: "fake-key" } };
		assert.deepEqual(await queryZaiCn(auth, new AbortController().signal), { kind: "error", code: "invalid-response" });
		assert.equal(calls.length, 1);
	});
});

test("queries a CN team quota only with complete account-scoped organization/project headers", async () => {
	const auth: RequestAuth = {
		route: "zai-cn", endpoint: "https://open.bigmodel.cn/api/coding/paas/v4",
		headers: { Authorization: "fake-key", "bigmodel-organization": "org-test", "bigmodel-project": "proj-test" },
	};
	await withFetch(new Response(JSON.stringify({ success: true, code: 200, data: { limits: [
		{ type: "CREDIT_LIMIT", percentage: 23, unit: 3, number: 5 },
	] } }), { status: 200 }), async (calls) => {
		assert.deepEqual(await queryZaiCn(auth, new AbortController().signal), {
			kind: "available", text: "额度 已用 23%(5h)", compact: "23%(5h)",
		});
		assert.equal(calls[0]?.url, "https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2");
		assert.deepEqual(calls[0]?.init?.headers, { ...auth.headers, Accept: "application/json" });
	});
});

test("maps HTTP and JSON failures explicitly and does not guess a Z.AI no-plan response", async () => {
	await withFetch(new Response("denied", { status: 401 }), async () => {
		assert.deepEqual(
			await queryZai(
				{ route: "zai", endpoint: "https://api.z.ai/api/coding/paas/v4", headers: { Authorization: "Bearer fake" } },
				new AbortController().signal,
			),
			{ kind: "error", code: "auth" },
		);
	});
	await withFetch(new Response("{", { status: 200, headers: { "content-type": "application/json" } }), async () => {
		assert.deepEqual(await queryCodex(codexAuth, new AbortController().signal), { kind: "error", code: "invalid-response" });
	});
	assert.deepEqual(parseZaiQuota({ success: false, message: "coding plan unavailable" }, "international"), { kind: "invalid" });
});
