import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mock, test } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerAgentTool } from "../src/children/agent-tool.ts";
import { protocolDirectory } from "./broker-fixtures.ts";

test("actor binding failure never spawns or acknowledges a child", async (t) => {
	const work = await protocolDirectory(t);
	const spawn = mock.method(childProcess, "spawn", () => { throw new Error("unexpected child spawn"); });
	syncBuiltinESMExports();
	t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
	const tools = new Map<string, ToolDefinition>();
	const pi = { registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); } } as unknown as ExtensionAPI;
	const acquired: string[] = [];
	registerAgentTool(pi, {
		model: "faux/test", projectDir: work, timeoutMs: 1000, rootSessionId: "root",
		acquireChildActor: async (agentId) => {
			acquired.push(agentId);
			throw new Error("actor binding unavailable");
		},
	});
	for (const name of ["Agent", "agent", "task", "subagent"]) {
		const tool = tools.get(name);
		assert.ok(tool);
		await assert.rejects(tool.execute("call", { description: "test", prompt: "no execution", subagent_type: "general" },
			undefined, undefined, {} as never), /actor binding unavailable/);
	}
	assert.equal(acquired.length, 4);
	assert.ok(acquired.every((agentId) => agentId.startsWith("ses_")));
	assert.equal(spawn.mock.callCount(), 0);
});
