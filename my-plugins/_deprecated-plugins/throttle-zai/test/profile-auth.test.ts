import { describe, expect, it } from "vitest";
import { wrapApiKeyAuth } from "../src/profile-auth.js";

const base = { name: "Gateway API key" };

describe("wrapApiKeyAuth resolution", () => {
	it("prefers stored credential, then configured key, else undefined", async () => {
		const auth = wrapApiKeyAuth(base, "configured");
		const stored = await auth.resolve({
			ctx: { env: () => undefined, fileExists: () => Promise.resolve(false) },
			credential: { type: "api_key", key: "stored" },
			signal: new AbortController().signal,
		});
		expect(stored).toMatchObject({ auth: { apiKey: "stored" }, source: "stored credential" });
		const configured = await auth.resolve({
			ctx: { env: () => undefined, fileExists: () => Promise.resolve(false) },
			signal: new AbortController().signal,
		});
		expect(configured).toMatchObject({ auth: { apiKey: "configured" }, source: "profile config" });
		const missing = await wrapApiKeyAuth(base, undefined).resolve({
			ctx: { env: () => undefined, fileExists: () => Promise.resolve(false) },
			signal: new AbortController().signal,
		});
		expect(missing).toBeUndefined();
	});

	it("expands $VAR and ${VAR}; missing variable yields undefined", async () => {
		process.env.TZAI_TEST_KEY = "expanded";
		process.env.TZAI_TEST_MISSING = "";
		delete process.env.TZAI_TEST_MISSING;
		const auth = wrapApiKeyAuth(base, "sk-$TZAI_TEST_KEY-${TZAI_TEST_KEY}");
		const resolved = await auth.resolve({
			ctx: { env: () => undefined, fileExists: () => Promise.resolve(false) },
			signal: new AbortController().signal,
		});
		expect(resolved?.auth.apiKey).toBe("sk-expanded-expanded");
		const broken = wrapApiKeyAuth(base, "$TZAI_TEST_MISSING");
		const failed = await broken.resolve({
			ctx: { env: () => undefined, fileExists: () => Promise.resolve(false) },
			signal: new AbortController().signal,
		});
		expect(failed).toBeUndefined();
	});
});
