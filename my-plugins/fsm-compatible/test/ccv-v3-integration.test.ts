import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { nativeIntegrationEnabled, nativeRuntimeFixture } from "./native-runtime-fixture.ts";
import { ccvDeliveryEnabled, prepareCcvV3Workspace } from "./ccv-delivery-workspace.ts";

const exec = promisify(execFile);

test("unchanged upstream CCV v3 reaches its prescribed V_A_LOOP endpoint on the repaired native runtime", {
	skip: !nativeIntegrationEnabled || !ccvDeliveryEnabled || !process.env.FSM_COMPATIBLE_TEST_CCV_MOCKER, timeout: 420000,
}, async (t) => {
	const scenario = fileURLToPath(new URL("./fixtures/ccv-v3-scenario.py", import.meta.url));
	const fixture = await nativeRuntimeFixture(t, "cli", { timeoutMs: 30000 }, undefined, scenario, prepareCcvV3Workspace);
	const context = JSON.parse(await readFile(join(fixture.directory, "ccv-v3-context.json"), "utf8")) as { library: string; env: Record<string, string> };
	const prompt = await exec("python3", ["-c", "import scenario_ext_v3; print(scenario_ext_v3.MAIN_PROMPT)"], {
		cwd: context.library, env: { ...process.env, ...context.env }, maxBuffer: 1024 * 1024,
	});
	const start = Date.now();
	assert.notEqual(await fixture.rpc.prompt(prompt.stdout.trim()), "handled");
	const deadline = Date.now() + 360000;
	for (;;) {
		try {
			const status = JSON.parse(await readFile(join(fixture.directory, "v3-output/status.json"), "utf8")) as { phase: string; detail?: string };
			assert.notEqual(status.phase, "failed", `upstream v3 assertion failed; inspect private ${fixture.directory}`);
			if (status.phase === "endpoint") {
				assert.match(status.detail ?? "", /V_A_LOOP/);
				await fixture.rpc.abort();
				await writeFile(join(fixture.directory, "v3-replay-result.json"), JSON.stringify({ passed: true, elapsed_ms: Date.now() - start, status }, null, 2));
				return;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" || Date.now() >= deadline) throw error;
		}
		if (Date.now() >= deadline) assert.fail(`upstream v3 timeout; inspect private ${fixture.directory}`);
		await delay(100);
	}
});
