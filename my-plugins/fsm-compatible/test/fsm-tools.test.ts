import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { FsmBroker } from "../src/broker/fsm-broker.ts";
import { registerProjectedTools } from "../src/broker/fsm-tools.ts";
import { projectMcpToolResult } from "../src/broker/mcp-tool-result.ts";
import { ROOT_SID, root } from "./admission-fixtures.ts";
import { fakeDaemon, fakeTransport, protocolDirectory } from "./broker-fixtures.ts";

function toolPi(existing: string[] = []) {
	const definitions = new Map<string, ToolDefinition>();
	const pi = {
		getAllTools: () => existing.map((name) => ({ name })),
		registerTool: (definition: ToolDefinition) => { definitions.set(definition.name, definition); },
	} as unknown as ExtensionAPI;
	return { pi, definitions };
}

async function toolOwner(t: { after(callback: () => Promise<void> | void): void }, mode = "normal") {
	const scope = join(await protocolDirectory(t), "coord");
	const daemon = fakeDaemon();
	const { transport, catalog } = await fakeTransport(t, mode);
	const broker = new FsmBroker({ host: { pid: process.pid, startId: "100" }, source: {
		rootSessionId: ROOT_SID, pid: process.pid, cwd: "/work", serverUrl: "http://127.0.0.1:9001",
	}, scope, request: daemon.request, transport, catalog });
	return { broker, catalog, timeoutMs: 1000, ready: () => true, binding: () => root() };
}

test("projection preserves text/images, structured data, errors and unknown MCP blocks in details", () => {
	const raw = { content: [{ type: "text", text: "blocked", annotations: { priority: 1 } },
		{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
		{ type: "resource", resource: { uri: "file:///a", text: "value" } }], structuredContent: { verdict: "block" }, isError: true };
	const projected = projectMcpToolResult(raw);
	assert.equal(projected.isError, true);
	assert.deepEqual(projected.structuredContent, raw.structuredContent);
	assert.deepEqual(projected.details, raw);
	assert.notEqual(projected.details, raw);
	assert.deepEqual(projected.content[1], raw.content[1]);
	assert.equal(projected.content[2]?.type, "text");
	for (const invalid of [{ content: [{}] }, { content: [], isError: "yes" }, { content: [], structuredContent: [] }]) {
		assert.throws(() => projectMcpToolResult(invalid), { code: "protocol-invalid" });
	}
});

test("registered execute uses canonical identity and returns complete results/progress", async (t) => {
	const owner = await toolOwner(t, "progress");
	const { pi, definitions } = toolPi();
	const deactivate = registerProjectedTools(pi, owner);
	assert.deepEqual([...definitions.keys()], ["fsm_fsm_get_state", "mcp__fsm__fsm_get_state", "fsm_fsm_set_var", "mcp__fsm__fsm_set_var"]);
	const tool = definitions.get("mcp__fsm__fsm_get_state")!;
	const ctx = { sessionManager: { getSessionId: () => "r" } } as unknown as ExtensionToolContext;
	const progress: unknown[] = [];
	const result = await tool.execute("call", {}, undefined, (value) => progress.push(value), ctx);
	assert.equal(progress.length, 1);
	assert.deepEqual(result.structuredContent, { tool: "fsm_get_state" });
	assert.equal(result.isError, false);
	deactivate();
	await assert.rejects(tool.execute("call", {}, undefined, undefined, ctx), { code: "not-ready" });
});

test("not-ready or foreign session cannot reach the broker", async (t) => {
	const owner = await toolOwner(t);
	let ready = false;
	const { pi, definitions } = toolPi();
	registerProjectedTools(pi, { ...owner, ready: () => ready });
	const tool = definitions.get("mcp__fsm__fsm_get_state")!;
	const ctx = { sessionManager: { getSessionId: () => "foreign" } } as unknown as ExtensionToolContext;
	await assert.rejects(tool.execute("call", {}, undefined, undefined, ctx), { code: "not-ready" });
	ready = true;
	await assert.rejects(tool.execute("call", {}, undefined, undefined, ctx), { code: "owner-unavailable" });
});

test("native/projected FSM tool conflicts are rejected without replacing existing tools", async (t) => {
	const owner = await toolOwner(t);
	for (const name of ["fsm_get_state", "mcp__fsm__fsm_get_state", "mcp__other__fsm_get_state"]) {
		const { pi, definitions } = toolPi([name]);
		assert.throws(() => registerProjectedTools(pi, owner), { code: "not-ready" });
		assert.equal(definitions.size, 0);
	}
});
