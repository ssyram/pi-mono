import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { nativeIntegrationEnabled, nativeRuntimeFixture } from "./native-runtime-fixture.ts";
import { parityScenarioOutcome } from "./parity-scenario-outcome.ts";

test("the real parent MCP channel survives a child's asynchronous completion turn", { skip: !nativeIntegrationEnabled, timeout: 120000 }, async (t) => {
	const scenario = fileURLToPath(new URL("./fixtures/oc-pi-parity-scenario.mjs", import.meta.url));
	const { rpc, work, request } = await nativeRuntimeFixture(t, "cli", {}, undefined, scenario);
	assert.notEqual(await rpc.prompt("PARITY:root"), "handled");
	const result = await parityScenarioOutcome(work);
	assert.deepEqual(result.files, { "main-ok": "main", "child-ready": "child", "child-ping": "ping", "release-parity": "release" });
	const actors = await request({ method: "GET", path: "/actors", deadline: Date.now() + 3000 });
	assert.equal(actors.status, 200);
	assert.ok((actors.body as { actors: { fsm_name: string }[] }).actors.every((actor) => actor.fsm_name === "_default"));
});
