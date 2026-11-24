import { describe, expect, it } from "vitest";
import { parsePluginConfig, pluginPaths } from "../src/plugin-config.js";

function base() {
	return {
		version: 1,
		executable: "/usr/local/bin/quota-throttle",
		controlUrl: "http://127.0.0.1:3001",
		relayBaseUrl: "http://127.0.0.1:3000/v1",
		plan: { kind: "team", organization: "org-1", project: "proj-1" },
		quota: { kind: "equal" },
	};
}

describe("plugin config", () => {
	it("accepts a valid team config and normalizes origins", () => {
		const parsed = parsePluginConfig(base());
		expect(parsed).toBeDefined();
		expect(parsed?.controlUrl).toBe("http://127.0.0.1:3001");
		expect(parsed?.relayBaseUrl).toBe("http://127.0.0.1:3000/v1");
	});

	it("accepts personal plans and weighted quota", () => {
		const parsed = parsePluginConfig({
			...base(),
			plan: { kind: "personal" },
			quota: { kind: "weighted", unit: "plan", keys: { "acct-a": { fiveHour: 1, weekly: 2 } } },
		});
		expect(parsed?.plan).toEqual({ kind: "personal" });
		expect(parsed?.quota.kind).toBe("weighted");
	});

	it("rejects non-loopback hosts, paths, https, same host, relative executable", () => {
		expect(parsePluginConfig({ ...base(), controlUrl: "http://0.0.0.0:3001" })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), controlUrl: "http://127.0.0.1:3001/x" })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), controlUrl: "https://127.0.0.1:3001" })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), relayBaseUrl: "http://127.0.0.1:3001/v1" })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), executable: "bin/quota-throttle" })).toBeUndefined();
	});

	it("rejects broken plans, quota and version", () => {
		expect(parsePluginConfig({ ...base(), plan: { kind: "team", organization: " ", project: "p" } })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), plan: { kind: "team", organization: "a\nb", project: "p" } })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), quota: { kind: "weighted", unit: "", keys: { a: { fiveHour: 1, weekly: 1 } } } })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), quota: { kind: "weighted", unit: "u", keys: {} } })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), quota: { kind: "weighted", unit: "u", keys: { a: { fiveHour: 0, weekly: 1 } } } })).toBeUndefined();
		expect(parsePluginConfig({ ...base(), version: 2 })).toBeUndefined();
	});

	it("derives plugin paths under the agent dir", () => {
		const paths = pluginPaths("/agent");
		expect(paths.configFile).toBe("/agent/throttle-zai/config.json");
		expect(paths.backendConfigFile).toBe("/agent/throttle-zai/backend/config.toml");
	});
});
