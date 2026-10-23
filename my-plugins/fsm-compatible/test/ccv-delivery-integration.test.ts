import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { nativeIntegrationEnabled, nativeRuntimeFixture } from "./native-runtime-fixture.ts";
import { ccvDeliveryEnabled, prepareCcvDeliveryWorkspace } from "./ccv-delivery-workspace.ts";

test("real CCodeVerify rejects invalid report then delivers an honest frontend failure and exits", {
	skip: !nativeIntegrationEnabled || !ccvDeliveryEnabled, timeout: 300000,
}, async (t) => {
	const scenario = fileURLToPath(new URL("./fixtures/ccv-delivery-scenario.mjs", import.meta.url));
	const fixture = await nativeRuntimeFixture(t, "cli", { timeoutMs: 30000 }, undefined, scenario, prepareCcvDeliveryWorkspace);
	assert.notEqual(await fixture.rpc.prompt("CCV-DELIVERY:fixture. The provided direct .i is immutable and syntactically invalid; replacement is forbidden. Exercise only honest failure delivery, never claim verified success."), "handled");
	const deadline = Date.now() + 180000;
	for (;;) {
		let failed: string | undefined;
		try { failed = await readFile(join(fixture.directory, "ccv-delivery-failure.json"), "utf8"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		assert.equal(failed, undefined, failed);
		try {
			const result = JSON.parse(await readFile(join(fixture.directory, "ccv-delivery-result.json"), "utf8")) as { passed: boolean; branch: string; no_cert: boolean };
			assert.equal(result.passed, true); assert.equal(result.branch, "V_FAILED"); assert.equal(result.no_cert, true);
			const actors = await fixture.request({ method: "GET", path: "/actors", deadline: Date.now() + 3000 });
			assert.equal(actors.status, 200);
			assert.ok((actors.body as { actors: { fsm_name: string }[] }).actors.every((actor) => actor.fsm_name === "_default"));
			await assert.rejects(readFile(join(fixture.work, "proof/vst/cert.json")), { code: "ENOENT" });
			const evidence = JSON.parse(await readFile(join(fixture.work, "proof/evidence/failure-evidence.json"), "utf8")) as { payload: { frontend_runs: unknown[] } };
			assert.ok(evidence.payload.frontend_runs.length > 0); return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" || Date.now() >= deadline) throw error;
		}
		await delay(50);
	}
});
