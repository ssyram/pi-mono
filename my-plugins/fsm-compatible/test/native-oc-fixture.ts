import assert from "node:assert/strict";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { startOwnedProcess } from "../src/process/owned-process.ts";
import { nativeBinaryFixture, nativeFreePort, waitNativeReady } from "./native-binary-fixture.ts";
import { nativeMockEnvironment } from "./native-mock-environment.ts";

export const ocParityEnabled = Boolean(process.env.FSM_COMPATIBLE_TEST_OC && process.env.FSM_COMPATIBLE_TEST_OC_PLUGIN && process.env.FSM_COMPATIBLE_TEST_HOOK);

export class OcFixtureStartupTimeout extends Error {
	readonly artifactPath: string;
	constructor(path: string) { super("OC fixture initialization timed out before any model request"); this.artifactPath = path; }
}

export async function nativeOcFixture(t: TestContext, scenario: string) {
	const base = await nativeBinaryFixture(t, scenario, "oc");
	try {
	const { directory, work, agentDir, dataDir, client, port, own } = base;
	const binary = process.env.FSM_COMPATIBLE_TEST_OC, plugin = process.env.FSM_COMPATIBLE_TEST_OC_PLUGIN, hook = process.env.FSM_COMPATIBLE_TEST_HOOK;
	assert.ok(binary && plugin && hook);
	const config = join(directory, "oc-config"), data = join(directory, "oc-data"), cache = join(directory, "oc-cache");
	await Promise.all([mkdir(join(config, "opencode"), { recursive: true }), mkdir(join(data, "opencode"), { recursive: true }),
		mkdir(join(cache, "opencode"), { recursive: true })]);
	const catalog = process.env.FSM_COMPATIBLE_TEST_OC_MODELS;
	assert.ok(catalog, "set FSM_COMPATIBLE_TEST_OC_MODELS to an existing public model catalog for offline OC startup");
	const modelsPath = join(cache, "opencode", "models.json"); await copyFile(catalog, modelsPath);
	await writeFile(join(config, "opencode", "opencode.json"), JSON.stringify({
		model: "native-mock/test", plugin: [], permission: { external_directory: "allow" },
		provider: { "native-mock": { npm: "@ai-sdk/openai-compatible", name: "Native mock",
			options: { baseURL: `http://127.0.0.1:${port}/native/v1` }, models: { test: { name: "test" } } } },
	}));
	await writeFile(join(data, "opencode", "auth.json"), JSON.stringify({ "native-mock": { type: "api", key: "mock-key" } }), { mode: 0o600 });
	const pluginCopy = join(directory, "fsm-plugin.mjs"); await copyFile(plugin, pluginCopy);
	await writeFile(join(work, "opencode.json"), JSON.stringify({
		mcp: { fsm: { type: "local", command: [client], enabled: true, timeout: 60000 } },
		plugin: [[pluginCopy, { hookBin: hook, fsmServerName: "fsm", hookTimeoutSeconds: 5 }]],
	}));
	const serverPort = await nativeFreePort(), url = `http://127.0.0.1:${serverPort}`;
	const env = nativeMockEnvironment({ HOME: agentDir, XDG_CONFIG_HOME: config, XDG_DATA_HOME: data,
		XDG_CACHE_HOME: cache, OPENCODE_MODELS_PATH: modelsPath, XDG_STATE_HOME: join(directory, "oc-state"),
		FSM_DATA_DIR: dataDir, OPENCODE_SERVER_URL: url, OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
		NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" });
	const server = startOwnedProcess("/bin/bash", ["-c", 'cd "$1" || exit; shift; exec "$@"', "oc-parity", work,
		binary, "--print-logs", "--log-level", "DEBUG", "serve", "--hostname", "127.0.0.1", "--port", String(serverPort)], env);
	let output = "", ended = false;
	server.child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-1024 * 1024); });
	server.child.stderr.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-1024 * 1024); });
	void server.closed.then(() => { ended = true; });
	own(async () => { const closed = await server.close(Date.now() + 5000);
		await writeFile(join(directory, "oc-server.log"), output, { mode: 0o600 }); assert.equal(closed, true); });
	const api = async (method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<unknown> => {
		const response = await fetch(`${url}${path}?directory=${encodeURIComponent(work)}`, {
			method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) throw new Error(`OC HTTP ${response.status} ${path}; inspect private log`);
		const text = await response.text(); return text ? JSON.parse(text) : undefined;
	};
	await waitNativeReady(async () => { const agents = await api("GET", "/agent", undefined, 30000); assert.ok(Array.isArray(agents)); }, () => !ended, 30000);
	const session = await api("POST", "/session", { title: "FSM parity" }) as { id: string; directory: string };
	assert.ok(session.id); assert.equal(session.directory, work);
	own(async () => { if (!ended) await api("POST", `/session/${session.id}/abort`).catch(() => undefined); });
	return { ...base, rootId: session.id, api, url,
		start: async (message: string) => { await api("POST", `/session/${session.id}/prompt_async`, {
			model: { providerID: "native-mock", modelID: "test" }, parts: [{ type: "text", text: message }],
		}); } };
	} catch (error) {
		let captures: string[];
		try { captures = await readdir(join(base.directory, "captures")); }
		catch (readError) {
			if ((readError as NodeJS.ErrnoException).code !== "ENOENT") { await base.close(); throw readError; }
			captures = [];
		}
		await base.close();
		if (error instanceof Error && error.name === "TimeoutError" && captures.filter((name) => name.startsWith("req-")).length === 0) {
			throw new OcFixtureStartupTimeout(base.directory);
		}
		throw error;
	}
}
