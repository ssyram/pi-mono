import { getProviders } from "@earendil-works/pi-ai/compat";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, test } from "vitest";
import type { SupportName } from "../config-entry.js";
import { getBase } from "../provider-source.js";

const names = ["openai-codex", "zai", "zai-coding-cn"] as const;

const officialBase = (name: SupportName) => {
	const official = builtinProviders().find((provider) => provider.id === name);
	if (official === undefined) throw new Error(`builtin provider missing: ${name}`);
	return official;
};

describe("C2 official provider sources", () => {
	for (const name of names) {
		test(`T-11 — ${name} comes from its official factory without catalog substitution`, () => {
			const official = officialBase(name);
			const base = getBase(name);

			expect(base.id).toBe(official.id);
			expect(base.name).toBe(official.name);
			expect(base.getModels()).toEqual(official.getModels());
		});
	}

	test("T-05 — the C2 source boundary rejects an unsupported provider name", () => {
		expect(() => getBase("unsupported" as SupportName)).toThrow("unsupported provider: unsupported");
	});

	test("T-33 — the production import channel resolves official catalogs for all three sources", () => {
		const builtinIds = new Set(getProviders());
		for (const name of names) {
			const base = getBase(name);
			expect(builtinIds.has(name)).toBe(true);
			expect(base.getModels().length).toBeGreaterThan(0);
			expect(base.getModels()).toEqual(officialBase(name).getModels());
		}
	});
});
