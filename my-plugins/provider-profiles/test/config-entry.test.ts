import { describe, expect, test } from "vitest";
import { parseEntries, type ValidationContext } from "../config-entry.js";

function profile(provider: string, apiKey?: unknown): Record<string, unknown> {
	return apiKey === undefined ? { provider } : { provider, apiKey };
}

function makeValidation(overrides?: Partial<ValidationContext>): ValidationContext {
	return {
		nameDenylist: new Set<string>(["builtin-one", "builtin-two"]),
		modelsJsonConflicts: new Set<string>(),
		supportedSources: new Set(["openai-codex", "zai", "zai-coding-cn"]),
		oauthSources: new Set(["openai-codex"]),
		...overrides,
	};
}

describe("C1 entry validation", () => {
	test("T-02 — accepts exactly the documented name boundaries and isolates invalid names", () => {
		const valid = ["a", "9", "a-", "a--b", "a".repeat(64)];
		const invalid = ["", "a".repeat(65), "Upper", "under_score", "has space", "slash/name", "名称", "-first"];
		const raw: Record<string, unknown> = {};
		for (const name of valid) raw[name] = profile("zai");
		for (const name of invalid) raw[name] = profile("zai");

		const result = parseEntries(raw, makeValidation());

		expect(new Set(result.entries.map((entry) => entry.name))).toEqual(new Set(valid));
		expect(new Set(result.errors.map((error) => error.name))).toEqual(new Set(invalid));
		expect(result.errors.every((error) => error.reason.includes("name must match"))).toBe(true);
	});

	test("T-03 — rejects every supplied built-in identity without rejecting neighbors", () => {
		const result = parseEntries(
			{
				"builtin-one": profile("zai"),
				"builtin-two": profile("zai-coding-cn"),
				independent: profile("zai"),
			},
			makeValidation(),
		);
		expect(result.entries.map((entry) => entry.name)).toEqual(["independent"]);
		expect(result.errors.map((error) => error.name)).toEqual(["builtin-one", "builtin-two"]);
	});

	test("T-05 — declines unrecognized providers and continues with valid entries", () => {
		const result = parseEntries(
			{ before: profile("zai"), unknown: profile("not-a-provider"), after: profile("zai-coding-cn") },
			makeValidation(),
		);
		expect(result.entries.map((entry) => entry.name)).toEqual(["before", "after"]);
		expect(result.errors).toMatchObject([{ name: "unknown" }]);
		expect(result.errors[0]?.reason).toContain("recognized built-in provider");
	});

	test("T-06 — rejects every apiKey-field appearance on OAuth entries (dynamic oauth set)", () => {
		const result = parseEntries(
			{
				nonempty: profile("openai-codex", "synthetic-key"),
				empty: profile("openai-codex", ""),
				"valid-codex": profile("openai-codex"),
				"valid-zai": profile("zai", "synthetic-key"),
			},
			makeValidation(),
		);
		expect(result.entries.map((entry) => entry.name)).toEqual(["valid-codex", "valid-zai"]);
		expect(result.errors.map((error) => error.name)).toEqual(["nonempty", "empty"]);
	});

	test("a provider outside the oauth set accepts an apiKey without error", () => {
		const result = parseEntries(
			{ keyed: profile("zai-coding-cn", "k"), bare: profile("zai-coding-cn") },
			makeValidation(),
		);
		expect(result.errors).toEqual([]);
		expect(result.entries).toHaveLength(2);
	});

	test("T-08 — reports each mixed entry error while preserving all independent entries", () => {
		const result = parseEntries(
			{
				first: profile("zai"),
				"bad-provider": profile("other"),
				"Bad_Name": profile("zai"),
				"openai-codex": profile("zai"),
				"bad-codex": profile("openai-codex", "synthetic-key"),
				last: profile("zai-coding-cn"),
			},
			makeValidation({ nameDenylist: new Set(["openai-codex"]) }),
		);
		expect(result.entries.map((entry) => entry.name)).toEqual(["first", "last"]);
		expect(result.errors.map((error) => error.name)).toEqual([
			"bad-provider",
			"Bad_Name",
			"openai-codex",
			"bad-codex",
		]);
	});
});
