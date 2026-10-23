import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import type { TestContext } from "node:test";
import { createDaemonRequester } from "../src/broker/daemon-request.ts";
import { startOwnedProcess } from "../src/process/owned-process.ts";
import { nativeMockEnvironment } from "./native-mock-environment.ts";

const exec = promisify(execFile);
export const nativeIntegrationEnabled = Boolean(process.env.FSM_COMPATIBLE_TEST_SERVER && process.env.FSM_COMPATIBLE_TEST_CLIENT
	&& process.env.FSM_COMPATIBLE_TEST_PI && process.env.FSM_COMPATIBLE_TEST_MOCK);

export async function nativeBinaryFixture(t: TestContext, scenario?: string, host = "pi") {
	const artifactBase = process.env.FSM_COMPATIBLE_TEST_ARTIFACTS;
	const base = artifactBase ?? fileURLToPath(new URL("./.tmp/", import.meta.url));
	await mkdir(base, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(join(resolve(base), "native-"));
	const cleanup: (() => Promise<void>)[] = [];
	const own = (dispose: () => Promise<void>) => { cleanup.push(dispose); };
	let closing: Promise<void> | undefined;
	const close = () => closing ??= (async () => {
		const errors: unknown[] = [];
		for (const dispose of cleanup.reverse()) { try { await dispose(); } catch (error) { errors.push(error); } }
		if (errors.length) throw new AggregateError(errors, `native cleanup incomplete; retained ${directory}`);
		if (!artifactBase) await rm(directory, { recursive: true, force: true });
	})();
	t.after(close);
	const work = join(directory, "work"), agentDir = join(directory, "agent");
	const dataDir = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "fsm-native-"));
	let daemonStopped = false;
	own(async () => {
		if (!daemonStopped) throw new Error(`unconfirmed daemon retained at ${dataDir}`);
		if (artifactBase) {
			await rm(join(dataDir, "server.sock"), { force: true });
			await cp(dataDir, join(directory, "daemon-data"), { recursive: true });
		}
		await rm(dataDir, { recursive: true, force: true });
	});
	await Promise.all([mkdir(work), mkdir(agentDir)]);
	const gitEnv = nativeMockEnvironment({ HOME: agentDir, XDG_CONFIG_HOME: join(directory, "git-config") });
	for (const key of Object.keys(gitEnv)) if (key.startsWith("GIT_")) delete gitEnv[key];
	await exec("git", ["init", "--quiet", "--initial-branch=main", work], { env: gitEnv });
	const gitDir = (await exec("git", ["-C", work, "rev-parse", "--absolute-git-dir"], { env: gitEnv })).stdout.trim();
	assert.equal(gitDir, join(work, ".git"));
	await exec("git", ["-C", work, "-c", "user.name=FSM fixture", "-c", "user.email=fixture@localhost", "commit", "--quiet", "--allow-empty", "-m", "native fixture baseline"], { env: gitEnv });
	await mkdir(join(dataDir, "skills"));
	for (const name of ["NativeRoot", "NativeWorker"]) await writeFile(join(dataDir, "skills", `${name}.yaml`), `name: ${name}
initial_state: WORK
exit_state: WORK
states:
  WORK:
    description: "native probe"
    instructions: "native integration probe"
    allow_dispatch_subagent: true
    tool_permissions:
      whitelist:
${name === "NativeRoot" ? `        - name: "^Agent$"
          requires_dispatch: true
        - name: "^(Read|Write|Edit|MultiEdit|Bash|Grep|Glob|LS|agent_list|agent_send|agent_stop)$"` : `        - name: ".*"`}
      blacklist:
${name === "NativeWorker" ? `        - name: "^Agent$"\n` : ""}
        - name: "^Write$"
          input:
            file_path: ".*/forbidden-child-write$"
    transitions: []
`);
	const server = process.env.FSM_COMPATIBLE_TEST_SERVER, client = process.env.FSM_COMPATIBLE_TEST_CLIENT;
	const cli = process.env.FSM_COMPATIBLE_TEST_PI, mock = process.env.FSM_COMPATIBLE_TEST_MOCK;
	assert.ok(server && client && cli && mock);
	const daemon = startOwnedProcess(server, ["serve", "--data-dir", dataDir], nativeMockEnvironment({ HOME: agentDir, FSM_DATA_DIR: dataDir }));
	let daemonError = "", daemonExited = false;
	daemon.child.stdout.resume(); daemon.child.stderr.on("data", (chunk: Buffer) => { daemonError = (daemonError + chunk.toString()).slice(-16000); });
	void daemon.closed.then(() => { daemonExited = true; });
	own(async () => { daemonStopped = await daemon.close(Date.now() + 5000);
		await writeFile(join(directory, "daemon.stderr.txt"), daemonError, { mode: 0o600 }); assert.equal(daemonStopped, true); });
	const request = createDaemonRequester(dataDir);
	let capabilities: unknown;
	await waitNativeReady(async () => { const reply = await request({ method: "GET", path: "/capabilities", deadline: Date.now() + 1000 });
		assert.equal(reply.status, 200); capabilities = reply.body; }, () => !daemonExited);
	const port = await nativeFreePort();
	const mockServer = startOwnedProcess(mock, ["--port", String(port), "--capture-dir", join(directory, "captures"),
		"--mounts-file", join(directory, "mounts.json")], nativeMockEnvironment({ HOME: agentDir, FSM_TEST_WORKSPACE: work, FSM_TEST_HOST: host }));
	mockServer.child.stdout.resume(); mockServer.child.stderr.resume();
	own(async () => { assert.equal(await mockServer.close(Date.now() + 5000), true); });
	await waitNativeReady(async () => { assert.ok((await fetch(`http://127.0.0.1:${port}/__admin/entries`)).ok); });
	const script = scenario ?? fileURLToPath(new URL("./fixtures/native-agent-scenario.mjs", import.meta.url));
	await chmod(script, 0o755);
	await exec(mock, ["add", script, "--name", "native", "--server-url", `http://127.0.0.1:${port}`], {
		env: nativeMockEnvironment({ HOME: agentDir, HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "" }),
	});
	await writeFile(join(directory, "run.json"), JSON.stringify({ test: t.name, host, created_at: new Date().toISOString(),
		capabilities, runtime_data_dir: dataDir, archived_data_dir: join(directory, "daemon-data"),
		source_id: process.env.FSM_COMPATIBLE_TEST_SOURCE_ID ?? null, server, client, cli, mock }, null, 2));
	return { directory, work, dataDir, agentDir, client, cli, port, request, own, close };
}

export async function nativeFreePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	return address.port;
}

export async function waitNativeReady(probe: () => Promise<void>, alive: () => boolean = () => true, timeoutMs = 10000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (!alive()) throw new Error("native service exited before readiness; inspect private daemon log");
		try { await probe(); return; } catch (error) { if (Date.now() >= deadline) throw error; }
		await delay(30);
	}
}
