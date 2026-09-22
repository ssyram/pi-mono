import { readModelsJsonProviderIds } from "../config-loader.js";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseEntries, type ValidationContext } from "../config-entry.js";
import { profileConfigPath } from "../provider-profiles-extension.js";

function makeValidation(overrides?: Partial<ValidationContext>): ValidationContext {
	return {
		nameDenylist: new Set<string>(),
		modelsJsonIds: new Set<string>(),
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

describe("G-02 — models.json provider-id denylist", () => {
	test("rejects names claimed by models.json providers while neighbors continue", () => {
		const result = parseEntries(
			{
				"zai-000-g-l": { provider: "zai", apiKey: "synthetic" },
				independent: { provider: "zai" },
			},
			makeValidation({ modelsJsonIds: new Set(["zai-000-g-l", "yunwu"]) }),
		);
		expect(result.entries.map((entry) => entry.name)).toEqual(["independent"]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.name).toBe("zai-000-g-l");
		expect(result.errors[0]?.reason).toContain("models.json");
	});

	test("readModelsJsonProviderIds: missing file yields an empty set", async () => {
		const ids = await readModelsJsonProviderIds(join(tempDir, "absent.json"));
		expect(ids.size).toBe(0);
	});

	test("readModelsJsonProviderIds: valid file yields its provider keys", async () => {
		const path = join(tempDir, "models.json");
		await writeFile(
			path,
			JSON.stringify({ providers: { yunwu: { baseUrl: "https://x" }, "zai-000-g-l": {} } }),
		);
		const ids = await readModelsJsonProviderIds(path);
		expect([...ids].sort()).toEqual(["yunwu", "zai-000-g-l"]);
	});

	test("readModelsJsonProviderIds: unparseable file yields an empty set without throwing", async () => {
		const path = join(tempDir, "models.json");
		await writeFile(path, "{broken");
		const ids = await readModelsJsonProviderIds(path);
		expect(ids.size).toBe(0);
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
