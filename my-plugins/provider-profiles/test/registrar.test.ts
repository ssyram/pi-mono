import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import type { ProfileEntry } from "../config-entry.js";
import { instanceProvider } from "../instantiator.js";
import { getBase } from "../provider-source.js";
import { registerInstances, type RegistrationItem } from "../registrar.js";

function item(name: string, provider: ProfileEntry["provider"]): RegistrationItem {
	const entry: ProfileEntry = provider === "openai-codex" ? { name, provider } : { name, provider, apiKey: "profile-key" };
	return { entry, provider: instanceProvider(getBase(provider), entry) };
}

describe("C4 registration", () => {
	test("T-13 — a rejected middle registration is isolated from later registrations and the success list", () => {
		const calls: string[] = [];
		const pi = {
			registerProvider(provider: Provider | string): void {
				if (typeof provider === "string") throw new Error("unexpected config registration");
				calls.push(provider.id);
				if (provider.id === "middle") throw new Error("synthetic rejection");
			},
		};
		const outcome = registerInstances(pi as unknown as ExtensionAPI, [
			item("first", "openai-codex"),
			item("middle", "zai"),
			item("last", "zai-coding-cn"),
		]);

		expect(calls).toEqual(["first", "middle", "last"]);
		expect(outcome.registered).toEqual(["first", "last"]);
		expect(outcome.failed).toEqual([
			{ name: "middle", reason: "registration failed: synthetic rejection" },
		]);
	});
});
