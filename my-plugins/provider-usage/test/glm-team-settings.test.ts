import assert from "node:assert/strict";
import test from "node:test";
import type { SettingValue } from "../../my-settings/index.ts";
import { GLM_TEAMS_SETTING, type ReadGlmTeams, resolveGlmTeam } from "../src/glm-team-settings.js";
import { route } from "../src/route.js";
import type { Selection } from "../src/usage-contract.js";
import { executeUsageQuery } from "../src/usage-query.js";
import { makeModel } from "./test-model.js";

const team = { providers: ["first", "second"], organization: "org-id", project: "project-id" };
const context = { organization: team.organization, project: team.project };
const settings =
	(value: SettingValue): ReadGlmTeams =>
	async () => ({
		ok: true,
		values: { [GLM_TEAMS_SETTING]: value },
	});

function selection(providerId = "first", endpoint = "https://api.z.ai/api/coding/paas/v4"): Selection {
	const model = makeModel({ provider: providerId, api: "openai-completions", baseUrl: endpoint });
	return { sessionId: "test-session", model, modelId: model.id, providerId, api: model.api, endpoint };
}

test("links multiple providers to one team and leaves unlinked accounts alone", () => {
	for (const provider of team.providers) {
		assert.deepEqual(resolveGlmTeam([team], provider), { kind: "team", context });
	}
	assert.deepEqual(resolveGlmTeam([team], "other"), { kind: "absent" });
	assert.deepEqual(resolveGlmTeam([], "first"), { kind: "absent" });
});

test("rejects ambiguous associations and malformed credentials without exposing them", () => {
	const malformed = [
		null,
		{},
		[null],
		[{}],
		[{ ...team, providers: [] }],
		[{ ...team, providers: ["first", "first"] }],
		[team, team],
		[{ ...team, providers: [7] }],
		[{ ...team, key: "" }],
		[{ ...team, organization: "" }],
		[{ ...team, project: " " }],
		[{ ...team, key: "key\r\nInjected: value" }],
	];
	for (const value of malformed) {
		assert.deepEqual(resolveGlmTeam(value, "first"), { kind: "error", code: "configuration" });
	}
});

test("explicit teams use each selected model's own key regardless of its model endpoint", async () => {
	const originalFetch = globalThis.fetch;
	const requests: { url: string; headers: Headers }[] = [];
	globalThis.fetch = async (input, options) => {
		requests.push({ url: String(input), headers: new Headers(options?.headers) });
		assert.equal(options?.redirect, "error");
		const percentage = new Headers(options?.headers).get("Authorization") === "key-first" ? 24 : 67;
		return Response.json({
			success: true,
			code: 200,
			data: { limits: [{ type: "CREDIT_LIMIT", percentage, unit: 6, number: 1 }] },
		});
	};
	try {
		for (const endpoint of ["https://api.z.ai/api/coding/paas/v4", "https://proxy.example/v1", "invalid"]) {
			for (const provider of team.providers) {
				const selected = selection(provider, endpoint);
				const result = await executeUsageQuery(
					selected,
					route(selected),
					{
						getApiKeyAndHeaders: async (model) => {
							assert.equal(model, selected.model);
							return { ok: true, apiKey: `key-${model.provider}`, headers: { "X-Private": "not-forwarded" } };
						},
					},
					new AbortController().signal,
					settings([team]),
				);
				assert.equal(result.kind, "available");
				if (result.kind === "available") assert.equal(result.compact, `${provider === "first" ? 24 : 67}%(week)`);
			}
		}
		assert.equal(requests.length, 6);
		for (const [index, request] of requests.entries()) {
			assert.equal(request.url, "https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2");
			assert.equal(request.headers.get("Authorization"), index % 2 === 0 ? "key-first" : "key-second");
			assert.equal(request.headers.has("X-Private"), false);
			assert.equal(request.headers.get("bigmodel-organization"), team.organization);
			assert.equal(request.headers.get("bigmodel-project"), team.project);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("unlinked providers keep their original model credentials and endpoint", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		assert.equal(String(input), "https://api.z.ai/api/monitor/usage/quota/limit");
		assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer model-key");
		return Response.json({ data: { limits: [{ type: "TOKENS_LIMIT", percentage: 7 }] } });
	};
	try {
		const selected = selection("unlinked");
		const result = await executeUsageQuery(
			selected,
			route(selected),
			{
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "model-key" }),
			},
			new AbortController().signal,
			settings([team]),
		);
		assert.equal(result.kind, "available");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("configuration errors and cancellation never fall back to model credentials or start HTTP", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("must not fetch");
	};
	const selected = selection();
	const registry = {
		getApiKeyAndHeaders: async () => {
			throw new Error("must not resolve auth");
		},
	};
	try {
		const readers: ReadGlmTeams[] = [
			settings([team, team]),
			settings([{ ...team, project: "" }]),
			async () => ({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "unavailable" } }),
			async () => {
				throw new Error("secret must not leak");
			},
		];
		for (const read of readers) {
			assert.deepEqual(
				await executeUsageQuery(selected, route(selected), registry, new AbortController().signal, read),
				{ kind: "error", code: "configuration" },
			);
		}
		const abort = new AbortController();
		const read: ReadGlmTeams = async () => {
			abort.abort();
			return { ok: true, values: { [GLM_TEAMS_SETTING]: [team] } };
		};
		assert.deepEqual(await executeUsageQuery(selected, route(selected), registry, abort.signal, read), {
			kind: "cancelled",
		});
		assert.deepEqual(
			await executeUsageQuery(selected, route(selected), registry, abort.signal, () => {
				throw new Error("must not read after cancellation");
			}),
			{ kind: "cancelled" },
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("team quota failures do not retry or switch account identity", async () => {
	const originalFetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests += 1;
		return Response.json({ success: true, data: {} });
	};
	try {
		const selected = selection();
		const result = await executeUsageQuery(
			selected,
			route(selected),
			{
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key-first" }),
			},
			new AbortController().signal,
			settings([team]),
		);
		assert.deepEqual(result, { kind: "error", code: "invalid-response" });
		assert.equal(requests, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
