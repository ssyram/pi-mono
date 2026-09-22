import type { ApiKeyAuth, AuthContext } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import type { ProfileEntry, SupportName } from "../config-entry.js";
import { instanceProvider, wrapApiKeyAuth } from "../instantiator.js";
import { getBase } from "../provider-source.js";

function officialApiKeyAuth(provider: SupportName): ApiKeyAuth {
	const auth = getBase(provider).auth.apiKey;
	if (auth === undefined) throw new Error(`${provider} has no API-key auth`);
	return auth;
}

function syntheticContext(): { context: AuthContext; env: ReturnType<typeof vi.fn> } {
	const env = vi.fn<(name: string) => Promise<string | undefined>>().mockResolvedValue("external-key");
	const fileExists = vi.fn<(path: string) => Promise<boolean>>().mockResolvedValue(false);
	return { context: { env, fileExists }, env };
}

const apiKeyProviders = ["zai", "zai-coding-cn"] as const;

describe("C3 API-key auth wrapping", () => {
	for (const provider of apiKeyProviders) {
		test(`T-14 — ${provider} resolves stored credential before profile config and then fails`, async () => {
			const { context, env } = syntheticContext();
			const auth = wrapApiKeyAuth(officialApiKeyAuth(provider), "profile-key");
			const signal = new AbortController().signal;

			await expect(
				auth.resolve({
					ctx: context,
					credential: { type: "api_key", key: "stored-key", env: { tenant: "stored-tenant" } },
					signal,
				}),
			).resolves.toEqual({
				auth: { apiKey: "stored-key" },
				env: { tenant: "stored-tenant" },
				source: "stored credential",
			});
			await expect(auth.resolve({ ctx: context, signal })).resolves.toEqual({
				auth: { apiKey: "profile-key" },
				source: "profile config",
			});
			await expect(
				wrapApiKeyAuth(officialApiKeyAuth(provider), undefined).resolve({ ctx: context, signal }),
			).resolves.toBeUndefined();
			expect(env).not.toHaveBeenCalled();
		});
	}

	test("T-15 — environment-only state cannot configure either Z.AI instance", async () => {
		for (const provider of apiKeyProviders) {
			const { context, env } = syntheticContext();
			await expect(
				wrapApiKeyAuth(officialApiKeyAuth(provider), undefined).resolve({
					ctx: context,
					signal: new AbortController().signal,
				}),
			).resolves.toBeUndefined();
			expect(env).not.toHaveBeenCalled();
		}
	});

	test("T-16 / T-17 / T-24 — no external credential source is observable or consulted", async () => {
		const { context, env } = syntheticContext();
		const result = await wrapApiKeyAuth(officialApiKeyAuth("zai"), undefined).resolve({
			ctx: context,
			signal: new AbortController().signal,
		});

		expect(result).toBeUndefined();
		expect(env).not.toHaveBeenCalled();
	});

	test("T-18 — after the own stored credential is absent, no external source revives the instance", async () => {
		const { context, env } = syntheticContext();
		const auth = wrapApiKeyAuth(officialApiKeyAuth("zai"), undefined);
		await expect(auth.resolve({ ctx: context, signal: new AbortController().signal })).resolves.toBeUndefined();
		expect(env).not.toHaveBeenCalled();
	});

	test("T-19 and G-04 — an empty stored key is absent and the own profile key remains valid", async () => {
		const { context, env } = syntheticContext();
		const result = await wrapApiKeyAuth(officialApiKeyAuth("zai-coding-cn"), "profile-key").resolve({
			ctx: context,
			credential: { type: "api_key", key: "" },
			signal: new AbortController().signal,
		});

		expect(result).toEqual({ auth: { apiKey: "profile-key" }, source: "profile config" });
		expect(env).not.toHaveBeenCalled();
	});

	test("T-23 — a credential-less instance retains its full catalog but resolves no auth", async () => {
		const entry: ProfileEntry = { name: "catalog-only", provider: "zai" };
		const instance = instanceProvider(getBase("zai"), entry);
		const auth = instance.auth.apiKey;
		if (auth === undefined) throw new Error("Z.AI instance lacks API-key auth");
		const { context, env } = syntheticContext();

		expect(instance.getModels().length).toBeGreaterThan(0);
		await expect(auth.resolve({ ctx: context, signal: new AbortController().signal })).resolves.toBeUndefined();
		expect(env).not.toHaveBeenCalled();
	});

	test("T-31 — only the supplied instance credential is read by the resolver", async () => {
		const { context, env } = syntheticContext();
		const result = await wrapApiKeyAuth(officialApiKeyAuth("zai"), undefined).resolve({
			ctx: context,
			credential: { type: "api_key", key: "own-slot-key" },
			signal: new AbortController().signal,
		});

		expect(result).toEqual({
			auth: { apiKey: "own-slot-key" },
			source: "stored credential",
		});
		expect(env).not.toHaveBeenCalled();
	});

	test("T-20 / T-27 — the official login function remains the same reference", () => {
		const baseAuth = officialApiKeyAuth("zai");
		const wrapped = wrapApiKeyAuth(baseAuth, "profile-key");

		expect(wrapped.name).toBe(baseAuth.name);
		expect(wrapped.login).toBe(baseAuth.login);
	});

	test("B06 boundary — an already-aborted signal stops resolution before any source lookup", async () => {
		const controller = new AbortController();
		controller.abort();
		const { context, env } = syntheticContext();

		await expect(
			wrapApiKeyAuth(officialApiKeyAuth("zai"), "profile-key").resolve({
				ctx: context,
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(env).not.toHaveBeenCalled();
	});
});
