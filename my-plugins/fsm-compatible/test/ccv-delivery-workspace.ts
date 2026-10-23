import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { nativeBinaryFixture } from "./native-binary-fixture.ts";
import { nativeMockEnvironment } from "./native-mock-environment.ts";

const exec = promisify(execFile);
export const ccvDeliveryEnabled = Boolean(process.env.FSM_COMPATIBLE_TEST_CCV_ROOT && process.env.FSM_COMPATIBLE_TEST_RUNTIME_ENV);

export async function prepareCcvDeliveryWorkspace(base: Awaited<ReturnType<typeof nativeBinaryFixture>>): Promise<NodeJS.ProcessEnv> {
	return prepareCcvWorkspace(base, "invalid");
}

export async function prepareCcvV3Workspace(base: Awaited<ReturnType<typeof nativeBinaryFixture>>): Promise<NodeJS.ProcessEnv> {
	return prepareCcvWorkspace(base, "v3");
}

async function prepareCcvWorkspace(base: Awaited<ReturnType<typeof nativeBinaryFixture>>, mode: "invalid" | "v3"): Promise<NodeJS.ProcessEnv> {
	const source = process.env.FSM_COMPATIBLE_TEST_CCV_ROOT, runtimeEnv = process.env.FSM_COMPATIBLE_TEST_RUNTIME_ENV;
	assert.ok(source && runtimeEnv);
	const framework = join(base.directory, "framework");
	await exec("git", ["clone", "--no-hardlinks", "--quiet", source, framework]);
	assert.equal((await exec("git", ["-C", framework, "status", "--porcelain"])).stdout.trim(), "");
	const original = await exec("/bin/bash", ["-c", 'source "$1"; env -0', "ccv-test", runtimeEnv], { env: nativeMockEnvironment({}), maxBuffer: 4 * 1024 * 1024 });
	const runtime: NodeJS.ProcessEnv = {};
	for (const pair of original.stdout.split("\0")) { const equal = pair.indexOf("="); if (equal > 0) runtime[pair.slice(0, equal)] = pair.slice(equal + 1); }
	assert.ok(runtime.HOME && runtime.CCV_INSTALL_CONFIG);
	const home = join(base.directory, "ccv-home"), temp = join(base.directory, "tmp");
	await Promise.all([mkdir(home), mkdir(temp), mkdir(join(base.directory, "opam-logs"))]);
	for (const path of [".mcp_server_fsm/binary-install.json", ".ccv-clight-inspector/binary-install.json"]) {
		await mkdir(dirname(join(home, path)), { recursive: true, mode: 0o700 });
		await copyFile(join(runtime.HOME, path), join(home, path));
	}
	const config = join(base.directory, "ccv-install.json"); await copyFile(runtime.CCV_INSTALL_CONFIG, config);
	const env = nativeMockEnvironment({ ...runtime, HOME: home, XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"), XDG_CACHE_HOME: join(home, ".cache"), XDG_STATE_HOME: join(home, ".local", "state"),
		CCV_INSTALL_CONFIG: config, CCV_VERIFY_ROOT: base.directory, FSM_DATA_DIR: base.dataDir,
		TMPDIR: temp, OPAMLOGS: join(base.directory, "opam-logs"), CCV_HOME: "", PYTHONDONTWRITEBYTECODE: "1" });
	for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
	await rm(base.work, { recursive: true });
	let installed;
	try { installed = await exec("python3", [join(framework, "install.py"), "workspace", "work", "--agent", "opencode", "--arch", "aarch64", "--switch", "fcil"],
		{ env: { ...env, GIT_AUTHOR_NAME: "FSM fixture", GIT_AUTHOR_EMAIL: "fixture@localhost",
			GIT_COMMITTER_NAME: "FSM fixture", GIT_COMMITTER_EMAIL: "fixture@localhost" },
			cwd: framework, maxBuffer: 8 * 1024 * 1024, timeout: 120000 }); }
	catch (error) {
		const failed = error as { stdout?: string; stderr?: string };
		await writeFile(join(base.directory, "ccv-workspace-install.log"), `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`, { mode: 0o600 }); throw error;
	}
	await writeFile(join(base.directory, "ccv-workspace-install.log"), `${installed.stdout}\n${installed.stderr}`, { mode: 0o600 });
	const workspaceEnv = await exec("/bin/bash", ["-c", 'source "$1"; env -0', "ccv-test", join(base.work, ".ccv-config", "env.sh")], { env, maxBuffer: 4 * 1024 * 1024 });
	for (const pair of workspaceEnv.stdout.split("\0")) { const equal = pair.indexOf("="); if (equal > 0) env[pair.slice(0, equal)] = pair.slice(equal + 1); }
	env.CCV_HOME = ""; env.FSM_DATA_DIR = base.dataDir;
	await exec("git", ["-C", base.work, "config", "user.name", "FSM fixture"], { env });
	await exec("git", ["-C", base.work, "config", "user.email", "fixture@localhost"], { env });
	await mkdir(join(base.work, "input", "src"), { recursive: true });
	if (mode === "v3") {
		const mocker = process.env.FSM_COMPATIBLE_TEST_CCV_MOCKER; assert.ok(mocker);
		const library = join(base.directory, "mocker"); await mkdir(library);
		for (const name of await readdir(mocker)) if (/\.(py|c|md)$/.test(name)) await copyFile(join(mocker, name), join(library, name));
		await copyFile(join(library, "ext_b50.c"), join(base.work, "ext_b50.c"));
		await exec("cc", ["-E", "-P", join(base.work, "ext_b50.c"), "-o", join(base.work, "ext_b50.i")], { env });
		const output = join(base.directory, "v3-output"); await mkdir(output);
		await writeFile(join(base.directory, "ccv-v3-context.json"), JSON.stringify({ library, env: {
			CCV_SMOKE_WS: base.work, CCV_SMOKE_OUT: output, CCV_SMOKE_FSM_BIN: process.env.FSM_COMPATIBLE_TEST_SERVER,
			CCV_SMOKE_FSM_DATA: base.dataDir, CCV_SMOKE_ANALYSIS_STATE: join(framework, "scripts/checks/formal/analysis_state.py"),
			PYTHONDONTWRITEBYTECODE: "1", HOME: home, OPAMROOT: env.OPAMROOT, PATH: env.PATH,
		} }), { mode: 0o600 });
		return env;
	}
	await writeFile(join(base.work, "input", "src", "broken.i"), "int main(void) { return 0;\n");
	await writeFile(join(base.work, "input", "targets.yaml"), "targets:\n  - memory_safety\narch: aarch64\n");
	await exec("git", ["-C", base.work, "add", "--", "input/src/broken.i", "input/targets.yaml"], { env });
	await exec("git", ["-C", base.work, "commit", "-m", "fixture: immutable frontend-rejected input"], { env });
	const head = (await exec("git", ["-C", base.work, "rev-parse", "HEAD"], { env })).stdout.trim();
	const context = { framework, workspace: base.work, head, directory: base.directory,
		report: join(base.work, "proof", "verify-report.md"), input: "immutable syntactically invalid direct .i; replacement prohibited for this test" };
	await writeFile(join(base.directory, "ccv-delivery-context.json"), JSON.stringify(context), { mode: 0o600 });
	assert.equal((await exec("git", ["-C", base.work, "status", "--porcelain"], { env })).stdout.trim(), "");
	return env;
}
