import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { nativeBinaryFixture, nativeIntegrationEnabled } from "./native-binary-fixture.ts";
import { nativeMockEnvironment } from "./native-mock-environment.ts";

export { nativeIntegrationEnabled };

export async function nativeRuntimeFixture(t: TestContext, installation: "cli" | "project",
	options: Record<string, unknown> = {}, requiredSource?: string, scenario?: string,
	prepare?: (base: Awaited<ReturnType<typeof nativeBinaryFixture>>) => Promise<NodeJS.ProcessEnv>) {
	const base = await nativeBinaryFixture(t, scenario);
	const preparedEnv = prepare ? await prepare(base) : {};
	const { directory, work, dataDir, agentDir, client, cli, port, own } = base;
	const provider = join(directory, "mock-provider.ts");
	await writeFile(provider, `import { Type } from "typebox";
export default function(pi) { pi.registerTool({ name: "native_test_crash", label: "native_test_crash",
		description: "test-only process failure", parameters: Type.Object({}), execute: async () => { process.exit(47); } });
		pi.registerProvider("native-mock", {
		baseUrl: "http://127.0.0.1:${port}/native/v1", api: "openai-completions", apiKey: "mock-key",
		models: [{ id: "test", name: "test", reasoning: ${options.mockReasoning === true}, input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] }); }`);
	const configPath = join(directory, "config.json"), requiredPath = join(directory, "required-extension.ts");
	if (requiredSource !== undefined) await writeFile(requiredPath, requiredSource);
	await writeFile(configPath, JSON.stringify({ dataDir, clientCommand: client, clientArgs: [], cwd: work,
		capacity: 8, timeoutMs: 5000, modelSource: {}, allowedAgentNames: ["general"], maxDepth: 2, ...options,
		...(requiredSource === undefined ? {} : { requiredExtensions: [{ id: "test-required", path: requiredPath }] }) }));
	const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
	await mkdir(join(work, ".pi"));
	if (installation === "project") await writeFile(join(work, ".pi/settings.json"), JSON.stringify({ packages: [entry] }));
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(nativeMockEnvironment({ HOME: agentDir, ...preparedEnv, PI_CODING_AGENT_DIR: agentDir, FSM_DATA_DIR: dataDir,
		FSM_COMPATIBLE_CLIENT: client, FSM_COMPATIBLE_CONFIG: configPath, FSM_TEST_WORKSPACE: work }))) if (value !== undefined) env[key] = value;
	for (const name of Object.keys(process.env)) if (name.startsWith("PI_") && name !== "PI_CODING_AGENT_DIR") env[name] = "";
	const startRpc = async (sessionFile?: string) => {
		const rpc = new RpcClient({ cliPath: cli, cwd: work, env, model: "native-mock/test",
			args: [...(installation === "cli" ? ["-ne", "-e", entry] : ["-a"]), "-e", provider,
				...(sessionFile ? ["--session", sessionFile] : [])] });
		own(async () => { await rpc.stop(); }); await rpc.start();
		const state = await rpc.getState();
		assert.equal(state.model?.provider, "native-mock"); assert.equal(state.model?.id, "test"); return rpc;
	};
	const rpc = await startRpc();
	let current = rpc;
	return { ...base, rpc, configPath, requiredPath, stateBase: join(agentDir, "fsm-compatible"),
		restart: async () => { const state = await current.getState(); assert.ok(state.sessionFile);
			await current.stop(); current = await startRpc(state.sessionFile); return current; } };
}
