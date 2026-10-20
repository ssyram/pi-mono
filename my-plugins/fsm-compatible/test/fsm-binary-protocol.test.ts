import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { FsmBroker } from "../src/broker/fsm-broker.ts";
import { readHostIdentity } from "../src/runtime/host-identity.ts";
import { root } from "./admission-fixtures.ts";
import test from "node:test";
import { createDaemonRequester, type DaemonReply } from "../src/broker/daemon-request.ts";
import { isAdmissionObject } from "../src/admission/parse-policy-input.ts";
import { requireDaemonCapabilities } from "../src/broker/daemon-capabilities.ts";
import { discoverFsmTools } from "../src/broker/fsm-catalog.ts";
import { McpTransport } from "../src/broker/mcp-transport.ts";
import { startOwnedProcess } from "../src/process/owned-process.ts";
import { protocolDirectory } from "./broker-fixtures.ts";

test("actual FSM daemon/Client handshake and full catalog work in an isolated data dir without a provider", async (t) => {
	const dataDir = await protocolDirectory(t);
	const env: NodeJS.ProcessEnv = { ...process.env, FSM_DATA_DIR: dataDir };
	delete env.FSM_CLIENT_LOG;
	const daemon = startOwnedProcess(process.env.FSM_COMPATIBLE_TEST_SERVER ?? "/Users/ssyram/bin/mcp-server-fsm", ["serve", "--data-dir", dataDir], env);
	daemon.child.stdout.resume();
	daemon.child.stderr.resume();
	t.after(async () => { assert.equal(await daemon.close(Date.now() + 10000), true); });
	const request = createDaemonRequester(dataDir);
	const deadline = Date.now() + 10000;
	let exited: unknown;
	void daemon.closed.then((exit) => { exited = exit; });
	let reply: DaemonReply;
	for (;;) {
		if (exited) assert.fail(`isolated daemon exited: ${JSON.stringify(exited)}`);
		try { reply = await request({ method: "GET", path: "/capabilities", deadline }); break; }
		catch (error) {
			if (Date.now() >= deadline) throw error;
			await delay(20);
		}
	}
	assert.equal(reply.status, 200);
	assert.ok(isAdmissionObject(reply.body));
	t.diagnostic(JSON.stringify({ serverVersion: reply.body.server_version,
		wire: reply.body.wire_contract_version, schema: reply.body.skill_schema_version, features: reply.body.features }));
	const capabilities = requireDaemonCapabilities(reply);
	assert.equal(capabilities.wireContractVersion, 2);
	const client = new McpTransport(process.env.FSM_COMPATIBLE_TEST_CLIENT ?? "/Users/ssyram/bin/mcp-server-fsm-client", [], env);
	t.after(async () => { assert.equal(await client.close(Date.now() + 10000), true); });
	await client.initialize({ deadline });
	const tools = await discoverFsmTools(client, { deadline });
	assert.ok(tools.has("fsm_get_state"));
	assert.ok(tools.has("fsm_set_var"));
	assert.ok(tools.has("fsm_try_transition"));
	assert.ok(tools.size >= 3);
	assert.deepEqual(await client.call("ping", {}, { deadline }), {});
	const host = await readHostIdentity(deadline);
	const broker = new FsmBroker({ host, source: { rootSessionId: "r", pid: process.pid, cwd: process.cwd(),
		serverUrl: "http://127.0.0.1:9001" }, request, transport: client, catalog: tools, scope: join(dataDir, "coord") });
	await broker.acquireActor(root(), { deadline });
	const state = await broker.invoke(root(), "fsm_get_state", {}, { deadline });
	assert.ok(Array.isArray(state.content));
	assert.ok(state.content.length > 0);
	assert.deepEqual(await readdir(join(dataDir, "coord")), []);
});
