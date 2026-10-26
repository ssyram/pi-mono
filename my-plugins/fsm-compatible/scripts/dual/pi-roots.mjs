import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";

export async function startPiRoots(options, roots) {
	const { run, work, agentDir, configPath, env, cliPath, plugin, providerExt, roles } = options;
	for (const role of roles) {
		const rootWork = work;
		const rootAgent = role === "root" ? agentDir : join(run, role, "agent");
		const rootConfig = role === "root" ? configPath : join(run, role, "plugin-config.json");
		for (const directory of [rootWork, rootAgent]) await mkdir(directory, { recursive: true });
		if (role !== "root") {
			const config = JSON.parse(await readFile(configPath, "utf8"));
			await writeFile(rootConfig, JSON.stringify({ ...config, cwd: rootWork, dataDir: join(run, role, "plugin-data") }));
			const init = spawnSync("/usr/bin/git", ["init", "--quiet", rootWork], { env });
			if (init.status !== 0) throw new Error(`git init ${role}: ${String(init.stderr)}`);
		}
		const rpc = new RpcClient({ cliPath, cwd: rootWork, env: { ...env,
			PI_CODING_AGENT_DIR: rootAgent, FSM_COMPATIBLE_CONFIG: rootConfig, FSM_TEST_WORKSPACE: rootWork,
			FSM_DUAL_STOP_LOG: join(run, "stop-decisions.jsonl"),
		}, model: "plot/plot-model", args: ["-ne", "-e", join(plugin, "src/index.ts"), "-e", providerExt] });
		const root = { role, rpc, work: rootWork, agentDir: rootAgent };
		roots.push(root);
		await rpc.start();
		const state = await rpc.getState();
		Object.assign(root, { sessionId: state.sessionId, sessionFile: state.sessionFile,
			protoSid: `ses_${createHash("sha256").update(state.sessionId).digest("hex").slice(0, 24)}` });
	}
	const sessions = roots.map(({ rpc, ...root }) => root);
	await writeFile(join(run, "pi-sessions.json"), JSON.stringify(sessions, null, 2));
	await writeFile(join(run, "pi-session.json"), JSON.stringify(sessions.find((root) => root.role === "root"), null, 2));
}
