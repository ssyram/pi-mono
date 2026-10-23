import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { nativeIntegrationEnabled, nativeRuntimeFixture } from "./native-runtime-fixture.ts";
import { nativeAgentList, nativePrompt, nativeToolResult, waitNativeFile, waitNativeReport } from "./native-agent-observations.ts";

async function bootstrapFor(base: string, id: string) {
	const roots = await readdir(base);
	assert.equal(roots.length, 1);
	return JSON.parse(await readFile(join(base, roots[0]!, id, "bootstrap.json"), "utf8")) as {
		coordinatorUrl: string; token: string; bridgePassword: string; binding: { parentSessionId: string };
	};
}

test("real native launch still requires the FSM dispatch queue", { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
	const { rpc, stateBase } = await nativeRuntimeFixture(t, "cli");
	const events = await nativePrompt(rpc, "CASE:empty-queue", "agent");
	assert.equal(nativeToolResult(events, "mcp__fsm__enter_fsm").isError, false);
	const rejected = nativeToolResult(events, "agent");
	assert.equal(rejected.isError, true); assert.match(rejected.text, /dispatch/i);
	assert.equal((await nativeAgentList(rpc)).length, 1);
	await assert.rejects(readdir(stateBase), { code: "ENOENT" });
});

test("real bridge publishes live child history without capabilities and protects its private control route", { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
	const { rpc, work, stateBase } = await nativeRuntimeFixture(t, "project");
	const events = await nativePrompt(rpc, "CASE:bridge", "agent");
	const started = nativeToolResult(events, "agent"); assert.equal(started.isError, false, started.text);
	const id = (JSON.parse(started.text) as { session_id: string }).session_id;
	await waitNativeFile(join(work, "child-fsm-present"));
	const bootstrap = await bootstrapFor(stateBase, id);
	const children = await fetch(`${bootstrap.coordinatorUrl}/session/${bootstrap.binding.parentSessionId}/children`);
	assert.equal(children.status, 200);
	assert.ok((await children.json() as { id: string }[]).some((row) => row.id === id));
	const messages = await fetch(`${bootstrap.coordinatorUrl}/session/${id}/message`);
	assert.equal(messages.status, 200);
	const text = JSON.stringify(await messages.json());
	assert.ok(text.includes("forbidden-child-write"), "child call missing from bridge history");
	assert.ok(/blacklist/i.test(text), "child denial missing from bridge history");
	assert.ok(!text.includes(bootstrap.token) && !text.includes(bootstrap.bridgePassword));
	const post = (body: unknown) => fetch(`${bootstrap.coordinatorUrl}/fsm-compatible/native-child`, {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
	});
	assert.equal((await post({ action: "list", input: { params: {} } })).status, 403);
	assert.equal((await post({ token: bootstrap.token, caller: bootstrap.binding.parentSessionId, action: "list", input: { params: {} } })).status, 400);
	const denied = await post({ token: bootstrap.token, action: "launch", input: { model: "native-mock/test", params: {
		description: "must not start", prompt: "CHILD:plain", subagent_type: "general", cwd: work } } });
	assert.ok(!denied.ok); assert.match(JSON.stringify(await denied.json()), /blacklist/i);
	assert.equal((await nativeAgentList(rpc)).length, 2);
	const released = nativeToolResult(await nativePrompt(rpc, "CONTROL:release", "Write"), "Write");
	assert.equal(released.isError, false, released.text);
	assert.match((await waitNativeReport(rpc, id))[0]!, / completed\]/);
});
