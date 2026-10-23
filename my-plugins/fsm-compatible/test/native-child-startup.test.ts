import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import { nativeIntegrationEnabled, nativeRuntimeFixture } from "./native-runtime-fixture.ts";
import { nativeAgentList, nativePrompt, nativeToolResult } from "./native-agent-observations.ts";

const exec = promisify(execFile);

async function observeProcess(base: string, depth: number): Promise<number> {
	const deadline = Date.now() + 10000;
	for (;;) {
		try {
			const paths = await readdir(base, { recursive: true });
			for (const name of paths.filter((path) => path.endsWith("bootstrap.json"))) {
				const data = JSON.parse(await readFile(join(base, name), "utf8")) as { depth: number };
				if (data.depth !== depth) continue;
				const bundle = join(base, dirname(name), "extensions.ts");
				const { stdout } = await exec("ps", ["-axww", "-o", "pid=,command="]);
				const row = stdout.split("\n").find((line) => line.includes(bundle));
				if (row) return Number(row.trim().split(/\s+/)[0]);
			}
		} catch (error) { if (Date.now() >= deadline) throw error; }
		if (Date.now() >= deadline) assert.fail("child process did not start");
		await delay(30);
	}
}

test("aborting a real launch during extension initialization closes only its own child", { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
	const { rpc, stateBase } = await nativeRuntimeFixture(t, "project", {},
		"export default async function() { await new Promise(resolve => setTimeout(resolve, 30000)); }");
	const run = nativePrompt(rpc, "CASE:loaded", "agent");
	const pid = await observeProcess(stateBase, 1);
	assert.ok(pid > 1);
	const start = performance.now();
	await rpc.abort(); await run;
	assert.ok(performance.now() - start < 5000, "abort must not wait for the startup deadline");
	assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
	assert.equal((await nativeAgentList(rpc)).length, 1);
});

test("stop cascades into a grandchild waiting for required-extension initialization", { skip: !nativeIntegrationEnabled, timeout: 60000 }, async (t) => {
	const { rpc, stateBase } = await nativeRuntimeFixture(t, "cli", { maxDepth: 3 }, `import { readFileSync } from "node:fs";
		export default async function() { const b = JSON.parse(readFileSync(process.env.FSM_CHILD_BOOTSTRAP, "utf8"));
		if (b.depth === 2) await new Promise(resolve => setTimeout(resolve, 30000)); }`);
	const started = nativeToolResult(await nativePrompt(rpc, "CASE:recursive", "agent"), "agent");
	assert.equal(started.isError, false, started.text);
	const id = (JSON.parse(started.text) as { session_id: string }).session_id;
	const grandchildPid = await observeProcess(stateBase, 2);
	const start = performance.now();
	const stopped = nativeToolResult(await nativePrompt(rpc, `CONTROL:stop:${id}`, "agent_stop"), "agent_stop");
	assert.equal(stopped.isError, false, stopped.text);
	assert.ok(performance.now() - start < 5000);
	assert.throws(() => process.kill(grandchildPid, 0), { code: "ESRCH" });
	assert.equal((await nativeAgentList(rpc)).find((row) => row.session_id === id)?.status, "idle");
});
