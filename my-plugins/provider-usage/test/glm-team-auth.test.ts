import assert from "node:assert/strict";
import test from "node:test";
import { queryGlmTeam } from "../src/glm-team-query.js";
import type { ResolvedModelAuth, Selection } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

const model = makeModel({ provider: "account" });
const selection: Selection = {
	sessionId: "test",
	model,
	modelId: model.id,
	providerId: model.provider,
	api: model.api,
	endpoint: model.baseUrl,
};
const team = { organization: "org", project: "project" };

test("team auth failures never send HTTP or substitute another account", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("must not fetch without an account key");
	};
	try {
		const cases: ResolvedModelAuth[] = [{ ok: false }, { ok: true }, { ok: true, apiKey: " " }];
		for (const resolved of cases) {
			assert.deepEqual(
				await queryGlmTeam(
					selection,
					team,
					{
						getApiKeyAndHeaders: async () => resolved,
					},
					new AbortController().signal,
				),
				{ kind: "error", code: "auth" },
			);
		}
		assert.deepEqual(
			await queryGlmTeam(
				selection,
				team,
				{
					getApiKeyAndHeaders: async () => {
						throw new Error("secret error must not leak");
					},
				},
				new AbortController().signal,
			),
			{ kind: "error", code: "auth" },
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cancelling before or during native auth does not send a team quota request", async () => {
	const abort = new AbortController();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("must not fetch after cancellation");
	};
	try {
		assert.deepEqual(
			await queryGlmTeam(
				selection,
				team,
				{
					getApiKeyAndHeaders: async () => {
						abort.abort();
						return { ok: true, apiKey: "account-key" };
					},
				},
				abort.signal,
			),
			{ kind: "cancelled" },
		);
		assert.deepEqual(
			await queryGlmTeam(
				selection,
				team,
				{
					getApiKeyAndHeaders: async () => {
						throw new Error("must not resolve auth after cancellation");
					},
				},
				abort.signal,
			),
			{ kind: "cancelled" },
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("each query resolves the current key and never forwards a different Authorization header", async () => {
	const originalFetch = globalThis.fetch;
	const requests: string[] = [];
	let currentKey = "old-key";
	globalThis.fetch = async (_input, options) => {
		requests.push(new Headers(options?.headers).get("Authorization") ?? "");
		return Response.json({ data: { limits: [{ type: "CREDIT_LIMIT", percentage: 9 }] } });
	};
	try {
		const registry = {
			getApiKeyAndHeaders: async () => ({
				ok: true,
				apiKey: currentKey,
				headers: { Authorization: "Bearer unrelated-key" },
			}),
		};
		assert.equal((await queryGlmTeam(selection, team, registry, new AbortController().signal)).kind, "available");
		currentKey = "new-key";
		assert.equal((await queryGlmTeam(selection, team, registry, new AbortController().signal)).kind, "available");
		assert.deepEqual(requests, ["old-key", "new-key"]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
