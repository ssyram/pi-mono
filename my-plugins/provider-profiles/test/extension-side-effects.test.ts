import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import { getProviders } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConfigError } from "../config-loader.js";
import providerProfilesExtension, { profileConfigPath } from "../provider-profiles-extension.js";

const state = vi.hoisted(() => ({ home: "", writes: [] as string[] }));

vi.mock("node:os", async () => ({
	...(await vi.importActual<typeof import("node:os")>("node:os")),
	homedir: (): string => state.home,
}));

vi.mock("node:fs/promises", async () => {
	const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
	return {
		...actual,
		writeFile: (...args: Parameters<typeof actual.writeFile>) => {
			state.writes.push(String(args[0]));
			return actual.writeFile(...args);
		},
	};
});

function recordingPi(): { pi: ExtensionAPI; providers: Provider[]; commands: string[] } {
	const providers: Provider[] = [];
const commands: string[] = [];
	const api = {
		registerProvider(provider: Provider | string): void {
			if (typeof provider === "string") throw new Error("unexpected config registration");
			providers.push(provider);
		},
	registerCommand(name: string): void {
		commands.push(name);
	},
	};
	return { pi: api as unknown as ExtensionAPI, providers, commands };
}

async function writeRaw(content: string): Promise<void> {
	const path = profileConfigPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

async function fileNames(path: string): Promise<string[]> {
	return (await readdir(path, { recursive: true })).sort();
}

beforeEach(async () => {
	state.home = await mkdtemp(join(tmpdir(), "provider-profiles-side-effects-"));
	const agentDirectory = join(state.home, ".pi", "agent");
	await mkdir(agentDirectory, { recursive: true });
	await writeFile(join(agentDirectory, "models.json"), '{"existing":"preserved"}', "utf8");
	await mkdir(join(state.home, "unrelated"), { recursive: true });
	await writeFile(join(state.home, "unrelated", "sentinel.txt"), "untouched", "utf8");
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(state.home, { force: true, recursive: true });
	state.home = "";
});

describe("extension non-interference", () => {
	test("T-30 — valid, mixed-invalid, and malformed loads leave built-ins and models.json unchanged", async () => {
		const builtinIds = new Set(getProviders());
		const modelsPath = join(state.home, ".pi", "agent", "models.json");
		const originalModels = await readFile(modelsPath, "utf8");
		const cases = [
			'{"valid":{"provider":"zai","apiKey":"synthetic-key"}}',
			'{"valid":{"provider":"zai","apiKey":"synthetic-key"},"bad":{"provider":"other"}}',
			'{"valid":{"provider":"zai"},',
		];

		for (const [index, content] of cases.entries()) {
			if (index > 0) await readFile(profileConfigPath(), "utf8");
			await writeRaw(content);
			const beforeFiles = await fileNames(state.home);
			const { pi, providers } = recordingPi();
			const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
			const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

			if (index === 2) {
				await expect(providerProfilesExtension(pi)).rejects.toBeInstanceOf(ConfigError);
			} else {
				await expect(providerProfilesExtension(pi)).resolves.toBeUndefined();
			}
			expect(providers.every((provider) => !builtinIds.has(provider.id))).toBe(true);
			expect(await readFile(modelsPath, "utf8")).toBe(originalModels);
			expect(await fileNames(state.home)).toEqual(beforeFiles);
			error.mockRestore();
			output.mockRestore();
		}
	});

	test("T-32 — plugin execution performs no writes to its injected home or unrelated sentinel", async () => {
		await writeRaw('{"profile":{"provider":"zai","apiKey":"synthetic-key"}}');
		const modelsPath = join(state.home, ".pi", "agent", "models.json");
		const sentinelPath = join(state.home, "unrelated", "sentinel.txt");
		const beforeFiles = await fileNames(state.home);
		const beforeModels = await readFile(modelsPath, "utf8");
		const beforeSentinel = await readFile(sentinelPath, "utf8");
		state.writes.length = 0;
		const { pi } = recordingPi();
		vi.spyOn(console, "log").mockImplementation(() => undefined);

		await providerProfilesExtension(pi);

		expect(state.writes).toEqual([]);
		expect(await fileNames(state.home)).toEqual(beforeFiles);
		expect(await readFile(modelsPath, "utf8")).toBe(beforeModels);
		expect(await readFile(sentinelPath, "utf8")).toBe(beforeSentinel);
	});
});
