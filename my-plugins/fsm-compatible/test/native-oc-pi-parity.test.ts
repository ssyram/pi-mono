import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { nativeIntegrationEnabled, nativeRuntimeFixture } from "./native-runtime-fixture.ts";
import { nativeOcFixture, ocParityEnabled, OcFixtureStartupTimeout } from "./native-oc-fixture.ts";
import { parityScenarioOutcome } from "./parity-scenario-outcome.ts";

test("same real FSM actions agree between OC and Pi", { skip: !nativeIntegrationEnabled || !ocParityEnabled, timeout: 180000 }, async (t) => {
	const scenario = fileURLToPath(new URL("./fixtures/oc-pi-parity-scenario.mjs", import.meta.url));
	let oc: Awaited<ReturnType<typeof nativeOcFixture>> | undefined;
	for (let attempt = 0; attempt < 3; attempt++) {
		try { oc = await nativeOcFixture(t, scenario); break; }
		catch (error) {
			if (!(error instanceof OcFixtureStartupTimeout) || attempt === 2) throw error;
			t.diagnostic(`OC startup timeout before model work; closed and retained ${error.artifactPath}`);
		}
	}
	assert.ok(oc);
	await oc.start("PARITY:root");
	const expected = await parityScenarioOutcome(oc.work);
	const pi = await nativeRuntimeFixture(t, "cli", {}, undefined, scenario);
	assert.notEqual(pi.dataDir, oc.dataDir); assert.notEqual(pi.work, oc.work);
	const disposition = await pi.rpc.prompt("PARITY:root"); assert.notEqual(disposition, "handled");
	const actual = await parityScenarioOutcome(pi.work);
	assert.deepEqual(actual, expected);
	for (const host of [oc, pi]) {
		const reply = await host.request({ method: "GET", path: "/actors", deadline: Date.now() + 3000 });
		assert.equal(reply.status, 200);
		const actors = (reply.body as { actors: { fsm_name: string }[] }).actors;
		assert.equal(actors.length, 2); assert.ok(actors.every((actor) => actor.fsm_name === "_default"));
		await writeFile(join(host.directory, "parity-result.json"), JSON.stringify({ passed: true, ...actual }, null, 2));
	}
});
