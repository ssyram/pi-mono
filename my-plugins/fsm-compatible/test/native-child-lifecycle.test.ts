import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { nativeIntegrationEnabled, nativeRuntimeFixture } from "./native-runtime-fixture.ts";
import { nativeAgentList, nativePrompt, nativeToolResult, waitNativeFile, waitNativeReport } from "./native-agent-observations.ts";

test("real child stop aborts the running shell and send resumes the same session", { skip: !nativeIntegrationEnabled, timeout: 60000 }, async (t) => {
	const { rpc, work } = await nativeRuntimeFixture(t, "project");
	const started = nativeToolResult(await nativePrompt(rpc, "CASE:slow", "agent"), "agent");
	assert.equal(started.isError, false, started.text);
	const id = (JSON.parse(started.text) as { session_id: string }).session_id;
	const shellPid = Number(await waitNativeFile(join(work, "child-shell-pid")));
	assert.ok(Number.isSafeInteger(shellPid) && shellPid > 1);
	const before = (await nativeAgentList(rpc)).find((row) => row.session_id === id);
	assert.equal(before?.status, "running");
	const stopped = nativeToolResult(await nativePrompt(rpc, `CONTROL:stop:${id}`, "agent_stop"), "agent_stop");
	assert.equal(stopped.isError, false, stopped.text);
	await assert.rejects(async () => { process.kill(shellPid, 0); }, { code: "ESRCH" });
	const idle = (await nativeAgentList(rpc)).find((row) => row.session_id === id);
	assert.equal(idle?.status, "idle"); assert.equal(idle?.last_outcome, "aborted");
	const sent = nativeToolResult(await nativePrompt(rpc, `CONTROL:send:${id}`, "agent_send"), "agent_send");
	assert.equal(sent.isError, false, sent.text);
	assert.equal(await waitNativeFile(join(work, "child-resumed")), "resumed");
	const after = (await nativeAgentList(rpc)).find((row) => row.session_id === id);
	assert.equal(after?.session_id, id); assert.equal(after?.pid, before?.pid);
});

test("real child inherits the caller's current thinking level rather than a default", { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
	const { rpc, stateBase } = await nativeRuntimeFixture(t, "cli", { mockReasoning: true });
	await rpc.setThinkingLevel("low"); assert.equal((await rpc.getState()).thinkingLevel, "low");
	const result = nativeToolResult(await nativePrompt(rpc, "CASE:loaded", "agent"), "agent");
	assert.equal(result.isError, false, result.text);
	const id = (JSON.parse(result.text) as { session_id: string }).session_id;
	await waitNativeReport(rpc, id);
	const root = (await rpc.getState()).sessionId;
	const records = (await readFile(join(stateBase, root, id, "session.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string; thinkingLevel?: string });
	assert.equal(records.findLast((record) => record.type === "thinking_level_change")?.thinkingLevel, "low");
});

test("input handled by a required extension is not falsely reported as a started run", { skip: !nativeIntegrationEnabled, timeout: 45000 }, async (t) => {
	const { rpc, work } = await nativeRuntimeFixture(t, "cli", {},
		"export default function(pi) { pi.on('input', event => event.text.includes('CHILD:guard') ? { action: 'handled' } : undefined); }");
	const result = nativeToolResult(await nativePrompt(rpc, "CASE:loaded", "agent"), "agent");
	assert.equal(result.isError, false, result.text);
	const info = JSON.parse(result.text) as { session_id: string; status: string };
	// tmux inbox model: the launch queues the prompt; the child-side input handler
	// consumes it so no model run starts — observed as queued→idle with no busy period.
	assert.equal(info.status, "queued");
	const row = (await nativeAgentList(rpc)).find((item) => item.session_id === info.session_id);
	assert.equal(row?.status, "idle");
	const sent = nativeToolResult(await nativePrompt(rpc, `CONTROL:send:${info.session_id}`, "agent_send"), "agent_send");
	assert.equal(sent.isError, false, sent.text);
	assert.equal(await waitNativeFile(join(work, "child-resumed")), "resumed");
});

test("a successful real automatic retry reports one completed run, not the intermediate provider failure", { skip: !nativeIntegrationEnabled, timeout: 60000 }, async (t) => {
	const { rpc, work } = await nativeRuntimeFixture(t, "cli");
	const start = nativeToolResult(await nativePrompt(rpc, "CASE:retry", "agent"), "agent");
	assert.equal(start.isError, false, start.text);
	const id = (JSON.parse(start.text) as { session_id: string }).session_id;
	const reports = await waitNativeReport(rpc, id);
	assert.equal(reports.length, 1); assert.match(reports[0]!, / completed\]/);
	assert.equal(await waitNativeFile(join(work, "retry-injected")), "once");
	assert.equal((await nativeAgentList(rpc)).find((row) => row.session_id === id)?.last_outcome, "completed");
});

test("a new real parent session cannot inherit the previous root's child records", { skip: !nativeIntegrationEnabled, timeout: 60000 }, async (t) => {
	const { rpc, work } = await nativeRuntimeFixture(t, "cli");
	const started = nativeToolResult(await nativePrompt(rpc, "CASE:slow", "agent"), "agent");
	assert.equal(started.isError, false, started.text);
	const oldRoot = (await rpc.getState()).sessionId;
	const shellPid = Number(await waitNativeFile(join(work, "child-shell-pid")));
	const alerts: string[] = [];
	const off = rpc.onEvent((event) => { const text = JSON.stringify(event); if (text.includes("failed to start")) alerts.push(text); });
	await rpc.newSession(); off();
	if (alerts.length) t.diagnostic(alerts.join("\n"));
	assert.notEqual((await rpc.getState()).sessionId, oldRoot);
	assert.throws(() => process.kill(shellPid, 0), { code: "ESRCH" });
	const rows = await nativeAgentList(rpc);
	assert.equal(rows.length, 1); assert.notEqual(rows[0]?.session_id, oldRoot);
});

test("restarting the real parent retains its child session and admission policy", { skip: !nativeIntegrationEnabled, timeout: 60000 }, async (t) => {
	const { rpc, work, restart } = await nativeRuntimeFixture(t, "project");
	const start = nativeToolResult(await nativePrompt(rpc, "CASE:loaded", "agent"), "agent");
	assert.equal(start.isError, false, start.text);
	const id = (JSON.parse(start.text) as { session_id: string }).session_id;
	await waitNativeFile(join(work, "child-fsm-present"));
	await nativeAgentList(rpc);
	const resumed = await restart();
	const rows = await nativeAgentList(resumed);
	assert.ok(rows.some((row) => row.session_id === id), "restored parent must retain the child record");
	const sent = nativeToolResult(await nativePrompt(resumed, `CONTROL:send:${id}`, "agent_send"), "agent_send");
	assert.equal(sent.isError, false, sent.text);
	assert.equal(await waitNativeFile(join(work, "child-resumed")), "resumed");
});

test("a real child process crash is not reported as completion and its session can resume", { skip: !nativeIntegrationEnabled, timeout: 60000 }, async (t) => {
	const { rpc, work } = await nativeRuntimeFixture(t, "cli");
	const started = nativeToolResult(await nativePrompt(rpc, "CASE:crash", "agent"), "agent");
	assert.equal(started.isError, false, started.text);
	const id = (JSON.parse(started.text) as { session_id: string }).session_id;
	let row = (await nativeAgentList(rpc)).find((item) => item.session_id === id);
	for (let attempt = 0; row?.available && attempt < 20; attempt++) {
		await delay(500);
		row = (await nativeAgentList(rpc)).find((item) => item.session_id === id);
	}
	assert.equal(row?.available, false); assert.equal(row?.last_outcome, "crashed");
	const sent = nativeToolResult(await nativePrompt(rpc, `CONTROL:send:${id}`, "agent_send"), "agent_send");
	assert.equal(sent.isError, false, sent.text);
	assert.equal(await waitNativeFile(join(work, "child-resumed")), "resumed");
	const after = (await nativeAgentList(rpc)).find((item) => item.session_id === id);
	assert.equal(after?.session_id, id);
	assert.equal(after?.available, true);
});
