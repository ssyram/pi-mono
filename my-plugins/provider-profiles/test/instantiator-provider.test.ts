import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { describe, expect, test } from "vitest";
import type { ProfileEntry, SupportName } from "../config-entry.js";
import { instanceProvider } from "../instantiator.js";
import { getBase } from "../provider-source.js";

const sources = [
	["openai-codex", openaiCodexProvider],
	["zai", zaiProvider],
	["zai-coding-cn", zaiCodingCnProvider],
] as const;

function entry(name: string, provider: SupportName): ProfileEntry {
	return provider === "openai-codex" ? { name, provider } : { name, provider, apiKey: "profile-key" };
}

describe("C3 instance providers", () => {
	for (const [provider, officialFactory] of sources) {
		test(`T-25 — ${provider} catalog is fully restamped from the official baseline`, () => {
			const profileName = `${provider}-profile`;
			const official = officialFactory();
			const instance = instanceProvider(getBase(provider), entry(profileName, provider));

			expect(instance.getModels()).toEqual(
				official.getModels().map((model) => ({ ...model, provider: profileName })),
			);
		});

		test(`T-26 — ${provider} instances do not mutate one another or their base`, () => {
			const base = getBase(provider);
			const before = base.getModels().map((model) => ({ ...model }));
			const first = instanceProvider(base, entry("first-profile", provider));
			const second = instanceProvider(base, entry("second-profile", provider));

			expect(first.getModels().every((model) => model.provider === "first-profile")).toBe(true);
			expect(second.getModels().every((model) => model.provider === "second-profile")).toBe(true);
			expect(base.getModels()).toEqual(before);
		});

		test(`T-27 — ${provider} preserves official request behavior references`, () => {
			const base = getBase(provider);
			const instance = instanceProvider(base, entry("reference-profile", provider));

			expect(instance.stream).toBe(base.stream);
			expect(instance.streamSimple).toBe(base.streamSimple);
			if (base.auth.apiKey === undefined) {
				expect(instance.auth).toBe(base.auth);
			} else {
				expect(instance.auth.apiKey?.login).toBe(base.auth.apiKey.login);
			}
		});
	}

	test("T-22 — two manually selected instance identities retain separate model routing", () => {
		const base = getBase("zai");
		const first = instanceProvider(base, entry("route-first", "zai"));
		const second = instanceProvider(base, entry("route-second", "zai"));

		expect(first.getModels().every((model) => model.provider === "route-first")).toBe(true);
		expect(second.getModels().every((model) => model.provider === "route-second")).toBe(true);
		expect(first.stream).toBe(base.stream);
		expect(second.streamSimple).toBe(base.streamSimple);
		expect(first.auth.apiKey).not.toBe(second.auth.apiKey);
	});

	test("T-21 — the OAuth instance shares the official OAuth auth object", () => {
		const base = getBase("openai-codex");
		const instance = instanceProvider(base, entry("codex-profile", "openai-codex"));

		expect(instance.auth).toBe(base.auth);
		expect(instance.auth.oauth).toBe(base.auth.oauth);
	});

	test("T-28 — only the documented eight own fields survive a future-source probe", () => {
		const base = getBase("zai");
		const probedBase = {
			...base,
			filterModels: () => [],
			probe: "not-allowed",
			refreshModels: () => Promise.resolve(),
		};
		const instance = instanceProvider(probedBase, entry("probed-profile", "zai"));

		expect(Object.keys(instance).sort()).toEqual(
			["auth", "baseUrl", "getModels", "headers", "id", "name", "stream", "streamSimple"].sort(),
		);
		expect("probe" in instance).toBe(false);
		expect(instance.refreshModels).toBeUndefined();
		expect(instance.filterModels).toBeUndefined();
	});

	test("T-29 — instance paths cannot carry static-source refresh or filter closures", () => {
		const base = getBase("zai-coding-cn");
		const probedBase = {
			...base,
			filterModels: () => [],
			refreshModels: () => Promise.resolve(),
		};
		const instance = instanceProvider(probedBase, entry("closed-profile", "zai-coding-cn"));

		expect(instance.refreshModels).toBeUndefined();
		expect(instance.filterModels).toBeUndefined();
		expect(instance.getModels().every((model) => model.provider === "closed-profile")).toBe(true);
	});
});
