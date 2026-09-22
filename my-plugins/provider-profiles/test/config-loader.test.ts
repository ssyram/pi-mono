import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ConfigError, readProfileConfig } from "../config-loader.js";

let directory = "";

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "provider-profiles-config-"));
});

afterEach(async () => {
	await rm(directory, { force: true, recursive: true });
});

describe("C1 config file loading", () => {
	test("T-07 — malformed JSON is a whole-config failure without file mutation", async () => {
		const path = join(directory, "provider-profiles.json");
		const malformed = '{"valid-prefix":{"provider":"zai"},';
		await writeFile(path, malformed, "utf8");

		await expect(readProfileConfig(path)).rejects.toBeInstanceOf(ConfigError);
		await expect(readProfileConfig(path)).rejects.toMatchObject({ path });
		expect(await readFile(path, "utf8")).toBe(malformed);
	});

	test("T-10 — loads only the selected configuration input and has no writes", async () => {
		const selected = join(directory, "provider-profiles.json");
		const decoy = join(directory, "other-profiles.json");
		const selectedContent = '{"chosen":{"provider":"zai"}}';
		const decoyContent = '{"decoy":{"provider":"openai-codex"}}';
		await writeFile(selected, selectedContent, "utf8");
		await writeFile(decoy, decoyContent, "utf8");

		await expect(readProfileConfig(selected)).resolves.toEqual({ chosen: { provider: "zai" } });
		expect(await readFile(selected, "utf8")).toBe(selectedContent);
		expect(await readFile(decoy, "utf8")).toBe(decoyContent);
	});

	test("G-01 — missing file is empty while non-object JSON is a ConfigError", async () => {
		await expect(readProfileConfig(join(directory, "missing.json"))).resolves.toEqual({});
		const arrayPath = join(directory, "array.json");
		await writeFile(arrayPath, "[]", "utf8");
		await expect(readProfileConfig(arrayPath)).rejects.toMatchObject({ path: arrayPath });
	});
});
