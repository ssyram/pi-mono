import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import { getProviders } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import providerProfilesExtension, { profileConfigPath } from "../provider-profiles-extension.js";

const state = vi.hoisted(() => ({ home: "" }));

vi.mock("node:os", async () => ({
	...(await vi.importActual<typeof import("node:os")>("node:os")),
	homedir: (): string => state.home,
}));

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

async function writeProfile(raw: Record<string, unknown>): Promise<void> {
	const path = profileConfigPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(raw), "utf8");
}

beforeEach(async () => {
	state.home = await mkdtemp(join(tmpdir(), "provider-profiles-extension-"));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(state.home, { force: true, recursive: true });
	state.home = "";
});

describe("extension registration orchestration", () => {
	test("T-01 — every valid configured identity registers once with its configured id", async () => {
		await writeProfile({
			"codex-one": { provider: "openai-codex" },
			"codex-two": { provider: "openai-codex" },
			"zai-one": { provider: "zai", apiKey: "synthetic-zai-one" },
			"zai-two": { provider: "zai", apiKey: "synthetic-zai-two" },
			"cn-one": { provider: "zai-coding-cn", apiKey: "synthetic-cn-one" },
			"cn-two": { provider: "zai-coding-cn", apiKey: "synthetic-cn-two" },
		});
		const { pi, providers } = recordingPi();
		const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await providerProfilesExtension(pi);

		expect(providers.map((provider) => provider.id)).toEqual([
			"codex-one",
			"codex-two",
			"zai-one",
			"zai-two",
			"cn-one",
			"cn-two",
		]);
		expect(new Set(providers.map((provider) => provider.id)).size).toBe(6);
		expect(output).toHaveBeenCalledWith(expect.stringContaining("codex-one"));
	});

	test("T-03 — every real built-in id is denied before registration while a neighbor succeeds", async () => {
		const builtins = getProviders();
		const raw: Record<string, unknown> = { neighbor: { provider: "zai", apiKey: "synthetic-key" } };
		for (const id of builtins) raw[id] = { provider: "zai", apiKey: "synthetic-key" };
		await writeProfile(raw);
		const { pi, providers } = recordingPi();
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await providerProfilesExtension(pi);

		expect(providers.map((provider) => provider.id)).toEqual(["neighbor"]);
		const diagnostics = errors.mock.calls.map((args) => args.join(" ")).join("\n");
		for (const id of builtins) expect(diagnostics).toContain(`"${id}"`);
	});

	test("T-08 — mixed entry errors are visible and do not stop valid registrations", async () => {
		await writeProfile({
			first: { provider: "zai", apiKey: "synthetic-key" },
			unknown: { provider: "not-supported" },
			Bad_Name: { provider: "zai" },
			"bad-codex": { provider: "openai-codex", apiKey: "synthetic-key" },
			last: { provider: "zai-coding-cn", apiKey: "synthetic-key" },
		});
		const { pi, providers } = recordingPi();
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await providerProfilesExtension(pi);

		expect(providers.map((provider) => provider.id)).toEqual(["first", "last"]);
		const diagnostics = errors.mock.calls.map((args) => args.join(" ")).join("\n");
		for (const name of ["unknown", "Bad_Name", "bad-codex"]) expect(diagnostics).toContain(`"${name}"`);
	});

	test("T-09 — a new complete load recognizes an identity added only in configuration", async () => {
		await writeProfile({ first: { provider: "zai", apiKey: "synthetic-key" } });
		const firstCycle = recordingPi();
		await providerProfilesExtension(firstCycle.pi);
		await readFile(profileConfigPath(), "utf8");
		await writeProfile({
			first: { provider: "zai", apiKey: "synthetic-key" },
			second: { provider: "zai-coding-cn", apiKey: "synthetic-key" },
		});
		const secondCycle = recordingPi();
		await providerProfilesExtension(secondCycle.pi);

		expect(firstCycle.providers.map((provider) => provider.id)).toEqual(["first"]);
		expect(secondCycle.providers.map((provider) => provider.id)).toEqual(["first", "second"]);
	});
});
