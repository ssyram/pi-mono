import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProfileEntry } from "../config-entry.js";
import { ConfigError } from "../config-loader.js";
import providerProfilesExtension, { profileConfigPath } from "../provider-profiles-extension.js";

const state = vi.hoisted(() => ({
	home: "",
	instantiationFailureName: "",
	sourceFailureProvider: "",
}));

vi.mock("node:os", async () => ({
	...(await vi.importActual<typeof import("node:os")>("node:os")),
	homedir: (): string => state.home,
}));

vi.mock("../provider-source.js", async () => {
	const actual = await vi.importActual<typeof import("../provider-source.js")>("../provider-source.js");
	return {
		...actual,
		getBase(name: string): Provider {
			if (name === state.sourceFailureProvider) throw new Error(`synthetic source failure: ${name}`);
			return actual.getBase(name);
		},
	};
});

vi.mock("../instantiator.js", async () => {
	const actual = await vi.importActual<typeof import("../instantiator.js")>("../instantiator.js");
	return {
		...actual,
		instanceProvider(base: Provider, entry: ProfileEntry, _forwardFilterModels = false): Provider {
			if (entry.name === state.instantiationFailureName) {
				throw new Error(`synthetic construction failure: ${entry.name}`);
			}
			return actual.instanceProvider(base, entry);
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

beforeEach(async () => {
	state.home = await mkdtemp(join(tmpdir(), "provider-profiles-isolation-"));
	state.instantiationFailureName = "";
	state.sourceFailureProvider = "";
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(state.home, { force: true, recursive: true });
	state.home = "";
});

describe("extension whole-config and per-entry failure boundaries", () => {
	test("T-07 — malformed JSON rejects before any registration", async () => {
		await writeRaw('{"valid-prefix":{"provider":"zai"},');
		const { pi, providers } = recordingPi();

		await expect(providerProfilesExtension(pi)).rejects.toBeInstanceOf(ConfigError);
		expect(providers).toEqual([]);
	});

	test("T-10 — profileConfigPath uses the documented fixed location", () => {
		expect(profileConfigPath()).toBe(join(state.home, ".pi", "agent", "provider-profiles.json"));
	});

	test("T-12 — source acquisition failure skips only its entry and continues", async () => {
		await writeRaw(
			JSON.stringify({
				first: { provider: "openai-codex" },
				"broken-source": { provider: "zai", apiKey: "synthetic-key" },
				last: { provider: "zai-coding-cn", apiKey: "synthetic-key" },
			}),
		);
		state.sourceFailureProvider = "zai";
		const { pi, providers } = recordingPi();
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(providerProfilesExtension(pi)).resolves.toBeUndefined();
		expect(providers.map((provider) => provider.id)).toEqual(["first", "last"]);
		expect(errors).toHaveBeenCalledWith(expect.stringContaining("broken-source"));
	});

	test("T-12 — instance construction failure skips only its entry and continues", async () => {
		await writeRaw(
			JSON.stringify({
				first: { provider: "openai-codex" },
				"broken-instance": { provider: "zai", apiKey: "synthetic-key" },
				last: { provider: "zai-coding-cn", apiKey: "synthetic-key" },
			}),
		);
		state.instantiationFailureName = "broken-instance";
		const { pi, providers } = recordingPi();
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(providerProfilesExtension(pi)).resolves.toBeUndefined();
		expect(providers.map((provider) => provider.id)).toEqual(["first", "last"]);
		expect(errors).toHaveBeenCalledWith(expect.stringContaining("broken-instance"));
	});
});
