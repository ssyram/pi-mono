import { readModelsJsonConflicts } from "../config-loader.js";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseEntries, type ValidationContext } from "../config-entry.js";
import { profileConfigPath } from "../provider-profiles-extension.js";

function makeValidation(overrides?: Partial<ValidationContext>): ValidationContext {
	return {
		nameDenylist: new Set<string>(),
		modelsJsonConflicts: new Set<string>(),
		supportedSources: new Set(["openai-codex", "zai", "zai-coding-cn"]),
		oauthSources: new Set(["openai-codex"]),
		...overrides,
	};
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "pp-gap-fixes-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("G-01 — config path mirrors host getAgentDir semantics", () => {
	test("honors PI_CODING_AGENT_DIR override through the host function", () => {
		const previous = process.env.PI_CODING_AGENT_DIR;
		try {
			process.env.PI_CODING_AGENT_DIR = tempDir;
			expect(profileConfigPath()).toBe(join(tempDir, "provider-profiles.json"));
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});

describe("G-02 — models.json overlays are classified by content", () => {
	test("same-name modelOverrides-only entries remain valid; provider settings still conflict", () => {
		const result = parseEntries(
			{
				"codex-001": { provider: "openai-codex" },
				"zai-with-key": { provider: "zai" },
				independent: { provider: "zai" },
			},
			makeValidation({ modelsJsonConflicts: new Set(["zai-with-key"]) }),
		);
		expect(result.entries.map((entry) => entry.name)).toEqual(["codex-001", "independent"]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.name).toBe("zai-with-key");
		expect(result.errors[0]?.reason).toContain("models.json");
	});

	test("missing file yields no conflicts", async () => {
		const conflicts = await readModelsJsonConflicts(join(tempDir, "absent.json"));
		expect(conflicts.size).toBe(0);
	});

	test("pure overrides are safe; provider-level apiKey/baseUrl and model headers are not", async () => {
		const path = join(tempDir, "models.json");
		await writeFile(path, JSON.stringify({ providers: {
			"codex-001": { modelOverrides: { "gpt-5.6-terra": { contextWindow: 1000000 } } },
			"zai-with-key": { apiKey: "synthetic" },
			"zai-with-url": { baseUrl: "https://example.test" },
			"zai-with-headers": { modelOverrides: { "glm-5.3": { headers: { Authorization: "Bearer synthetic" } } } },
			"empty-entry": {},
		} }));
		const conflicts = await readModelsJsonConflicts(path);
		expect([...conflicts].sort()).toEqual(["zai-with-headers", "zai-with-key", "zai-with-url"]);
	});

	test("supports host JSON comments, trailing commas and BOM", async () => {
		const path = join(tempDir, "models.json");
		await writeFile(path, '\uFEFF{"providers": { // comment\n "codex-002": {"modelOverrides":{"gpt-5.6-terra":{"contextWindow":300000,},},}, "unsafe":{"apiKey":"synthetic"},}}');
		expect([...await readModelsJsonConflicts(path)]).toEqual(["unsafe"]);
	});

	test("unparseable file yields no conflicts (host itself rejects that config)", async () => {
		const path = join(tempDir, "models.json");
		await writeFile(path, "{broken");
		const conflicts = await readModelsJsonConflicts(path);
		expect(conflicts.size).toBe(0);
	});
});

describe("G-07 — reserved storage keys", () => {
	test("rejects constructor (inherited Object.prototype property) with a visible error", () => {
		const result = parseEntries(
			{ constructor: { provider: "zai", apiKey: "synthetic" }, ok: { provider: "zai" } },
			makeValidation(),
		);
		expect(result.entries.map((entry) => entry.name)).toEqual(["ok"]);
		expect(result.errors[0]?.name).toBe("constructor");
		expect(result.errors[0]?.reason).toContain("reserved");
	});

	test("lowercase variants that do not exactly match inherited keys remain legal", () => {
		const result = parseEntries({ valueof: { provider: "zai" } }, makeValidation());
		expect(result.entries.map((entry) => entry.name)).toEqual(["valueof"]);
		expect(result.errors).toHaveLength(0);
	});
});
