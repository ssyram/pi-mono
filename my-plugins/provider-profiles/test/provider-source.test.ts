import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, test } from "vitest";
import { builtinIds, getBase, isOAuthSource, shouldForwardFilterModels, supportedSourceIds } from "../provider-source.js";

const officialById = () => new Map(builtinProviders().map((provider) => [provider.id, provider]));

describe("C2 official provider sources", () => {
	test("T-11 — every dynamically supported source is an official factory product", () => {
		const official = officialById();
		for (const name of supportedSourceIds()) {
			const base = getBase(name);
			const expected = official.get(name);
			expect(expected, name).toBeDefined();
			expect(base.id).toBe(expected?.id);
			expect(base.name).toBe(expected?.name);
			expect(base.getModels()).toEqual(expected?.getModels());
		}
	});

	test("T-05 — dynamic source boundary rejects unknown and refreshModels sources", () => {
		expect(() => getBase("unsupported")).toThrow("unsupported provider: unsupported");
		expect(supportedSourceIds()).not.toContain("radius");
		expect(() => getBase("radius")).toThrow("unsupported provider: radius");
	});

	test("T-33 — supported ids are built-ins and oauth/filter classifications match source facts", () => {
		const allBuiltins = builtinIds();
		for (const name of supportedSourceIds()) {
			expect(allBuiltins.has(name)).toBe(true);
			expect(getBase(name).getModels().length).toBeGreaterThan(0);
		}
		expect(isOAuthSource("openai-codex")).toBe(true);
		expect(isOAuthSource("zai")).toBe(false);
		expect(shouldForwardFilterModels("github-copilot")).toBe(true);
		expect(shouldForwardFilterModels("zai")).toBe(false);
	});
});
