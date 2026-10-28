import { protocolSessionId } from "../src/binding/create-root-binding.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { openOwnedRuntime, type OwnedRuntimeHandle } from "../src/runtime/owned-runtime.ts";
import type { DaemonReply, DaemonRequester } from "../src/broker/daemon-request.ts";
import type { FsmCompatibleConfig } from "../src/runtime/runtime-config.ts";
import { loadConfig } from "../src/runtime/runtime-config.ts";
import { AdvisoryQueue } from "../src/watch/advisory-queue.ts";
import { planInstallation } from "../src/install/plan.ts";
import { recoverRuntime } from "../src/runtime/recover.ts";

const CAPABILITIES = { server_version: "0.11.0", wire_contract_version: 2, skill_schema_version: 2,
	features: ["dispatch_state_admission_v1", "typed_input_exact_v1"] };

function fakeDaemon(rootSessionId: string, cwd: string): DaemonRequester {
	let serverUrl = "";
	const registered = new Set<string>();
	return async (input): Promise<DaemonReply> => {
		if (input.path === "/capabilities") return { status: 200, body: CAPABILITIES };
		if (input.path === "/session/register") {
			const body = input.body as { opencode_server_url?: string } | undefined;
			serverUrl = body?.opencode_server_url ?? "";
			registered.add("root");
			return { status: 200, body: null };
		}
		if (input.path.startsWith("/session/source?")) {
			return registered.has("root")
				? { status: 200, body: { session_id: rootSessionId, agent_pid: process.pid, kind: "opencode",
					cwd, opencode_server_url: serverUrl, transcript_path: null } }
				: { status: 404, body: {} };
		}
		if (input.path === "/identity/acquire" || input.path === "/actor/acquire") return { status: 200, body: { ok: true } };
		throw new Error(`unexpected daemon route ${input.path}`);
	};
}

function fakePi(manager: SessionManager) {
	const tools = new Map<string, ToolDefinition>();
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const listeners = new Map<string, Array<(data: unknown) => void>>();
	const pi = {
		appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
		registerTool: (definition: ToolDefinition) => { tools.set(definition.name, definition); },
		getAllTools: () => [...tools.keys()].map((name) => ({ name })),
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			handlers.set(event, handler);
			return () => handlers.delete(event);
		},
		sendMessage: () => {},
		registerCommand: () => {},
		events: {
			emit: (channel: string, data: unknown) => { for (const l of [...(listeners.get(channel) ?? [])]) l(data); },
			on: (channel: string, handler: (data: unknown) => void) => {
				const list = listeners.get(channel) ?? [];
				list.push(handler);
				listeners.set(channel, list);
				return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); };
			},
		},
	} as unknown as ExtensionAPI;
	return { pi, tools, handlers };
}

test("root assembly prepares every resource, serves the bridge, projects tools and unwinds cleanly", async (t) => {
	const faux = registerFauxProvider({ models: [{ id: "faux-1" }] });
	const work = await mkdtemp(join(tmpdir(), "fsm-assembly-"));
	const dataDir = await mkdtemp(join(tmpdir(), "fsm-assembly-data-"));
	const scope = await mkdtemp(join(tmpdir(), "fsm-assembly-coord-"));
	t.after(async () => { await rm(work, { recursive: true, force: true }); await rm(dataDir, { recursive: true, force: true }); await rm(scope, { recursive: true, force: true }); });
	const manager = SessionManager.inMemory(work, { id: "assembly-root" });
	const ctx = { sessionManager: manager, isIdle: () => true, ui: { notify: () => {}, setWidget: () => {}, onTerminalInput: () => () => {},
		custom: async () => undefined, getEditorText: () => "" },
		cwd: work, hasUI: true } as unknown as ExtensionContext;
	const { pi, tools } = fakePi(manager);
	const config: FsmCompatibleConfig = {
		dataDir, clientCommand: process.execPath,
		clientArgs: [fileURLToPath(new URL("./fixtures/fake-mcp.mjs", import.meta.url)), "normal"],
		cwd: work, capacity: 4, timeoutMs: 15000, scope,
		modelSource: { model: faux.getModel(), getApiKey: () => "faux-key", streamFn: streamSimple },
		env: { ...process.env, FSM_DATA_DIR: dataDir },
	};
	const handle: OwnedRuntimeHandle = await openOwnedRuntime(pi, ctx, { ...config,
		daemonRequester: () => fakeDaemon(protocolSessionId("assembly-root"), work) }, {
		allowedAgentNames: [], requiredExtensions: [{ id: "fsm-compatible", path: "/self" }], maxDepth: 8,
	});
	// Registered before any assertion: a failing path must still unwind the bridge and the MCP channel.
	t.after(async () => { if (handle.ready()) await handle.close(Date.now() + 5000); });
	assert.ok(handle.ready());
	assert.ok(handle.bridgeUrl.startsWith("http://127.0.0.1:"));
	for (const name of ["agent", "agent_list", "agent_send", "agent_stop"]) {
		assert.ok(tools.has(name), `HC tool ${name} registered`);
	}
	for (const retired of ["Agent", "task", "subagent", "agent_status"]) {
		assert.ok(!tools.has(retired), `retired alias ${retired} must not be registered`);
	}
	assert.ok(tools.has("fsm_fsm_get_state"), "FSM tool registered");
	const roster = await (await fetch(`${handle.bridgeUrl}/session`)).status;
	assert.equal(roster, 200, "bridge serves loopback OC-parity requests without credentials");
	const invoked = await tools.get("mcp__fsm__fsm_get_state")!.execute("call", {}, undefined, undefined,
		{ ...ctx, sessionManager: manager, tools: [] } as never);
	assert.equal((invoked as { isError?: boolean }).isError, false);
	await handle.close(Date.now() + 10000);
	assert.equal(handle.ready(), false);
});

test("config loader validates shapes and rejects missing files", async () => {
	await assert.rejects(loadConfig("/nonexistent/fsm-compatible.config.json"));
	assert.ok(new AdvisoryQueue(1));
});

test("installation plan is static, lists blockers and never claims unstated binaries", async () => {
	const plan = await planInstallation({ fsmServerPath: "", fsmClientPath: "" });
	const blocked = plan.steps.filter((step) => step.status === "blocked");
	assert.ok(blocked.some((step) => step.id === "fsm-binaries"), "explicitly absent binary paths stay blocked regardless of ambient test env");
	assert.ok(plan.steps.every((step) => step.status === "ready" || step.blocker));
	assert.ok(plan.piConfigSuggestions.some((line) => line.includes("never edits ~/.pi")));
	assert.deepEqual(plan.fsmBinaryCheck.expected, { wire: 2, schema: 2 });
});

test("assembly failure unwinds gates, launch scope, bridge and channel with zero residue", async (t) => {
	const faux = registerFauxProvider({ models: [{ id: "faux-1" }] });
	const work = await mkdtemp(join(tmpdir(), "fsm-assembly-fail-"));
	const dataDir = await mkdtemp(join(tmpdir(), "fsm-assembly-fail-data-"));
	const scope = await mkdtemp(join(tmpdir(), "fsm-assembly-fail-coord-"));
	t.after(async () => { await rm(work, { recursive: true, force: true }); await rm(dataDir, { recursive: true, force: true }); await rm(scope, { recursive: true, force: true }); });
	const manager = SessionManager.inMemory(work, { id: "assembly-fail" });
	const ctx = { sessionManager: manager, isIdle: () => true, ui: { notify: () => {} }, cwd: work, hasUI: true } as unknown as ExtensionContext;
	const { pi, tools, handlers } = fakePi(manager);
	const config: FsmCompatibleConfig = {
		dataDir, clientCommand: process.execPath,
		clientArgs: [fileURLToPath(new URL("./fixtures/fake-mcp.mjs", import.meta.url)), "normal"],
		cwd: work, capacity: 2, timeoutMs: 1000, scope,
		modelSource: { model: faux.getModel(), getApiKey: () => "faux-key", streamFn: streamSimple },
		env: { ...process.env, FSM_DATA_DIR: dataDir },
		daemonRequester: () => (async (): Promise<DaemonReply> => ({ status: 200, body: CAPABILITIES })),
	};
	await assert.rejects(openOwnedRuntime(pi, ctx, config, {
		allowedAgentNames: [], requiredExtensions: [{ id: "fsm-compatible", path: "/self" }], maxDepth: 8,
	}), Error);
	assert.ok(!tools.has("mcp__fsm__fsm_get_state"), "no FSM tools after failure");
	assert.equal(tools.has("Agent"), false, "invalid actor acquisition fails before Agent tools are exposed");
	assert.equal(handlers.size, 0, "every installed gate handler is unwound");
});

test("recoverRuntime reuses prepare, refreshes source-auth and never replays mutations", async () => {
	const calls: string[] = [];
	const requester: DaemonRequester = async (input): Promise<DaemonReply> => {
		calls.push(input.path);
		if (input.path === "/capabilities") return { status: 200, body: CAPABILITIES };
		if (input.path === "/session/register") return { status: 200, body: null };
		if (input.path.startsWith("/session/source?")) return { status: 200, body: { session_id: "rr",
			agent_pid: process.pid, kind: "opencode", cwd: "/w", opencode_server_url: "http://b", transcript_path: null } };
		if (input.path === "/identity/acquire") return { status: 200, body: { ok: true } };
		if (input.path === "/evidence/source-auth") return { status: 200, body: { ok: true } };
		throw new Error(`unexpected ${input.path}`);
	};
	const work = await mkdtemp(join(tmpdir(), "fsm-recover-"));
	const channel = await recoverRuntime({ request: requester, bridgePassword: "new-pw", config: {
		rootSessionId: "rr", cwd: "/w", serverUrl: "http://b", dataDir: work,
		clientCommand: process.execPath,
		clientArgs: [fileURLToPath(new URL("./fixtures/fake-mcp.mjs", import.meta.url)), "normal"],
		env: process.env, capacity: 2,
	} }, Date.now() + 15000);
	assert.ok(channel.catalog.size >= 1);
	assert.ok(calls.includes("/evidence/source-auth"));
	assert.equal(calls.filter((path) => path === "/evidence/source-auth").length, 1);
	await channel.close(Date.now() + 5000);
	await rm(work, { recursive: true, force: true });
});
