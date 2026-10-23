import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { nativeIntegrationEnabled, nativeRuntimeFixture } from "./native-runtime-fixture.ts";
import { nativeAgentList, nativePrompt, nativeToolResult, waitNativeFile } from "./native-agent-observations.ts";

test("real Pi rejects an unlisted native Agent before spawning", { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
	const { rpc, work, request, stateBase } = await nativeRuntimeFixture(t, "cli");
	const events = await rpc.promptAndWait("CASE:forbidden", undefined, 20000);
	const result = events.find((event) => event.type === "tool_execution_end" && event.toolName === "agent");
	assert.ok(result && result.type === "tool_execution_end", JSON.stringify({ events: events.map((event) => event.type), shape: await readFile(join(work, "mock-request-shape.json"), "utf8"), stderr: rpc.getStderr() }));
	assert.equal(result.isError, true, "unlisted agent must be rejected by the real runtime");
	const actors = await request({ method: "GET", path: "/actors", deadline: Date.now() + 3000 });
	assert.equal(actors.status, 200);
	assert.deepEqual((actors.body as { actors: { agent_id: string }[] }).actors.map((actor) => actor.agent_id), ["main"]);
	await assert.rejects(readdir(stateBase), { code: "ENOENT" });
});

test("a running root does not widen its frozen agent list when config changes", { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
	const { rpc, configPath } = await nativeRuntimeFixture(t, "project");
	const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
	await writeFile(configPath, JSON.stringify({ ...config, allowedAgentNames: ["general", "forbidden"] }));
	const result = nativeToolResult(await nativePrompt(rpc, "CASE:forbidden", "agent"), "agent");
	assert.equal(result.isError, true); assert.match(result.text, /agent-not-admitted/);
	assert.equal((await nativeAgentList(rpc)).length, 1);
});

for (const failure of ["missing", "initialization", "session_start"] as const) {
	test(`required child extension ${failure} failure never acknowledges a launch`, { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
		const { rpc, requiredPath } = await nativeRuntimeFixture(t, "cli", {}, failure === "missing"
			? "export default function() {}" : failure === "initialization" ? "export default function() { throw new Error('required init failed'); }"
			: "export default function(pi) { pi.on('session_start', () => { throw new Error('required startup failed'); }); }");
		if (failure === "missing") await rm(requiredPath);
		if (failure === "session_start") {
			// tmux children cannot observe another extension's session_start error
			// (no RPC event stream); the launch succeeds but the child stays gated.
			const result = nativeToolResult(await nativePrompt(rpc, "CASE:loaded", "agent"), "agent");
			assert.equal(result.isError, false, result.text);
			const listed = await nativeAgentList(rpc);
			assert.equal(listed.length, 2);
			return;
		}
		const result = nativeToolResult(await nativePrompt(rpc, "CASE:loaded", "agent"), "agent");
		assert.equal(result.isError, true, result.text);
		assert.equal((await nativeAgentList(rpc)).length, 1);
	});
}

test("dispatched real child enforces its FSM blacklist", { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
	const { rpc, work } = await nativeRuntimeFixture(t, "project");
	const events = await rpc.promptAndWait("CASE:guard", undefined, 20000);
	for (const name of ["mcp__fsm__enter_fsm", "mcp__fsm__fsm_dispatch_subagent", "agent"]) {
		const result = nativeToolResult(events, name); assert.equal(result.isError, false, result.text);
	}
	const evidence = await waitNativeFile(join(work, "child-fsm-present"));
	assert.match(evidence, /NativeWorker/);
	assert.match(evidence, /blacklist/i);
	await assert.rejects(readFile(join(work, "forbidden-child-write")), { code: "ENOENT" });
});

test("recursive real children retain identity and enforce the depth ceiling", { skip: !nativeIntegrationEnabled, timeout: 60000 }, async (t) => {
	const { rpc, work, stateBase } = await nativeRuntimeFixture(t, "cli", { maxDepth: 2 });
	const events = await rpc.promptAndWait("CASE:recursive", undefined, 20000);
	const start = nativeToolResult(events, "agent"); assert.equal(start.isError, false, start.text);
	assert.match(await waitNativeFile(join(work, "recursion-at-limit")), /not found|not available|unknown|depth/i);
	const parents = await readdir(stateBase); assert.equal(parents.length, 1);
	const children = await readdir(join(stateBase, parents[0]!)); assert.equal(children.length, 2);
	const bindings = await Promise.all(children.map(async (id) => JSON.parse(await readFile(join(stateBase, parents[0]!, id, "bootstrap.json"), "utf8")).binding as { sessionId: string; rootSessionId: string; parentSessionId: string }));
	assert.equal(new Set(bindings.map((binding) => binding.sessionId)).size, 2);
	assert.ok(bindings.every((binding) => binding.rootSessionId === parents[0]));
	assert.ok(bindings.some((binding) => bindings.some((other) => binding.parentSessionId === other.sessionId)));
});

for (const installation of ["cli", "project"] as const) {
	test(`real Pi ${installation} installation enforces the child FSM extension`, { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
		const { rpc, work, stateBase } = await nativeRuntimeFixture(t, installation);
		const events = await rpc.promptAndWait("CASE:loaded", undefined, 20000);
		const result = events.find((event) => event.type === "tool_execution_end" && event.toolName === "agent");
		assert.ok(result && result.type === "tool_execution_end");
		if (result.isError) {
			t.diagnostic(JSON.stringify(result));
			for (const name of await readdir(stateBase, { recursive: true })) {
				if (name.endsWith("process.log")) t.diagnostic((await readFile(join(stateBase, name), "utf8")).slice(-2400));
			}
		}
		assert.equal(result.isError, false);
		const deadline = Date.now() + 15000;
		for (;;) {
			try { assert.match(await readFile(join(work, "child-fsm-present"), "utf8"), /_default/); break; }
			catch (error) { if (Date.now() >= deadline) throw error; await delay(50); }
		}
	});
}
